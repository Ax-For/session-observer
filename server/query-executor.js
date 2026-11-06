const { fork, execFile } = require("child_process");
const path = require("path");

function createQueryExecutor(options = {}) {
  let child = null;
  let active = null;
  let sequence = 0;
  let closed = false;
  let idleTimer;
  let childRss = 0;
  let peakRss = process.memoryUsage().rss;
  const queue = [];
  const history = [];
  const budget = options.budgetBytes || 280 * 1024 * 1024;
  const remember = (job, status, error = "") => {
    history.unshift({ id: job.id, operation: job.operation, status, durationMs: Date.now() - job.startedAt, endedAt: new Date().toISOString(), error });
    if (history.length > 30) history.length = 30;
  };

  function startNext() {
    clearTimeout(idleTimer);
    if (closed || active) return;
    if (!queue.length) {
      idleTimer = setTimeout(() => child?.kill(), options.idleMs || 30_000);
      idleTimer.unref?.();
      return;
    }
    if (!child) {
      child = fork(options.workerFile || path.join(__dirname, "..", "server.js"), ["--query-worker"], {
        execArgv: ["--max-old-space-size=112", "--max-semi-space-size=4", "--optimize-for-size", "--expose-gc"],
        stdio: ["ignore", "ignore", "pipe", "ipc"],
        env: { ...process.env, OBSERVER_CODEX_VERSION: require("./versions").codexVersion,
          OBSERVER_CLAUDE_VERSION: require("./versions").claudeVersion, ...options.env },
      });
      child.stderr.on("data", (chunk) => {
        if (/FATAL ERROR|heap out of memory/.test(String(chunk))) failActive("Query exceeded its memory budget");
      });
      child.on("message", (message) => {
        if (!active || message.id !== active.id) return;
        if (message.progress) { active.progress = message.progress; return; }
        const job = active;
        active = null;
        clearTimeout(job.timer);
        job.cleanup();
        childRss = message.memory?.rss || childRss;
        remember(job, message.error ? "failed" : "completed", message.error);
        if (message.error) job.reject(new Error(message.error));
        else job.resolve(message.result);
        startNext();
      });
      child.on("error", () => failActive("Query worker could not start"));
      child.on("exit", () => {
        child = null;
        childRss = 0;
        if (active) {
          const job = active;
          active = null;
          clearTimeout(job.timer);
          job.cleanup();
          remember(job, "failed", "Worker stopped; source data is unchanged");
          job.reject(new Error("Query worker stopped; retry the operation"));
        }
        startNext();
      });
    }
    if (!child.connected || child.killed) return;
    active = queue.shift();
    active.startedAt = Date.now();
    active.timer = setTimeout(() => failActive("Query timed out; narrow the range and retry"), options.timeoutMs || 90_000);
    child.send({ id: active.id, operation: active.operation, args: active.args });
  }

  function failActive(reason) {
    if (active) {
      const job = active;
      active = null;
      clearTimeout(job.timer);
      job.cleanup();
      remember(job, "cancelled", reason);
      job.reject(new Error(reason));
    }
    child?.kill("SIGKILL");
  }

  function run(operation, args = [], { signal } = {}) {
    if (closed || signal?.aborted) return Promise.reject(new Error("Query cancelled"));
    if (queue.length >= 8) return Promise.reject(new Error("Query queue is full; retry shortly"));
    return new Promise((resolve, reject) => {
      const job = { id: ++sequence, operation, args, resolve, reject, startedAt: Date.now(), progress: null };
      const abort = () => {
        if (active === job) failActive("Query cancelled");
        else {
          const index = queue.indexOf(job);
          if (index >= 0) queue.splice(index, 1);
          job.cleanup();
          reject(new Error("Query cancelled"));
        }
      };
      job.cleanup = () => signal?.removeEventListener("abort", abort);
      signal?.addEventListener("abort", abort, { once: true });
      queue.push(job);
      // Interactive reads wait only for the current job, not queued background summaries.
      const priority = (item) => ["getDialogueBody", "getDialogueContext", "getEventDetail"].includes(item.operation) ? 0
        : item.operation === "queryEvents" ? 1 : 2;
      queue.sort((left, right) => priority(left) - priority(right) || left.id - right.id);
      startNext();
    });
  }

  const monitor = setInterval(() => {
    const pid = child?.pid;
    if (!pid) return;
    execFile("ps", ["-o", "rss=", "-p", String(pid)], { timeout: 1000, maxBuffer: 1024 }, (error, stdout) => {
      if (child?.pid !== pid || error) return;
      childRss = (Number(stdout.trim()) || 0) * 1024;
      const combined = process.memoryUsage().rss + childRss;
      peakRss = Math.max(peakRss, combined);
      if (combined > budget && active) failActive("Combined memory budget reached; operation cancelled safely");
    });
  }, 500);
  monitor.unref?.();

  function state() {
    const main = process.memoryUsage();
    return { mainRss: main.rss, workerRss: childRss, combinedRss: main.rss + childRss, peakRss, budget,
      workerPid: child?.pid || null, queued: queue.length,
      active: active ? { id: active.id, operation: active.operation, startedAt: active.startedAt, progress: active.progress } : null,
      history };
  }

  function reset() { failActive("Query cancelled by recovery action"); }
  function close() {
    closed = true;
    clearTimeout(idleTimer);
    clearInterval(monitor);
    for (const job of queue.splice(0)) { job.cleanup(); job.reject(new Error("Server stopped")); }
    failActive("Server stopped");
  }
  function cancel(id) {
    if (active?.id === id) { failActive("Query cancelled by user"); return true; }
    return false;
  }
  return { run, state, reset, close, cancel, invalidate: () => {
    if (child?.connected && !child.killed) child.send({ operation: "invalidate" }, () => {});
  } };
}

module.exports = { createQueryExecutor };
