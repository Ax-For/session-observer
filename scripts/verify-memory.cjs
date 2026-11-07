const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const assert = require("node:assert/strict");
const { spawn, execFile } = require("node:child_process");
const { promisify } = require("node:util");
const { setTimeout: delay } = require("node:timers/promises");
const net = require("node:net");

async function main() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "observer-dense-memory-"));
  const codex = path.join(root, ".codex/sessions");
  const claude = path.join(root, ".claude/projects");
  fs.mkdirSync(codex, { recursive: true });
  fs.mkdirSync(claude, { recursive: true });
  const file = path.join(claude, "dense-session.jsonl");
  const fd = fs.openSync(file, "w");
  let bytes = 0;
  let records = 0;
  const image = "A".repeat(512 * 1024);
  const now = Date.now();
  try {
    while (bytes < 400 * 1024 * 1024) {
      const row = { type: "assistant", sessionId: "dense-session", uuid: `row-${records}`, timestamp: new Date(now - 86400000 + records * 1000).toISOString(),
        message: { id: `msg-${records}`, model: "claude-sonnet-4-5", content: [
          { type: "image", source: { type: "base64", media_type: "image/png", data: image } },
          { type: "text", text: `密集日志校验 ${records} needle-${records}` },
        ], usage: { input_tokens: 100, output_tokens: 10, cache_read_input_tokens: 200, cache_creation_input_tokens: 20 } } };
      const line = JSON.stringify(row) + "\n";
      bytes += fs.writeSync(fd, line);
      records += 1;
    }
  } finally { fs.closeSync(fd); }
  const listener = net.createServer();
  await new Promise((resolve) => listener.listen(0, "127.0.0.1", resolve));
  const port = listener.address().port;
  await new Promise((resolve) => listener.close(resolve));
  const server = spawn(process.execPath, ["--max-old-space-size=64", "--max-semi-space-size=4", "--optimize-for-size", "--expose-gc", "server.js"], {
    cwd: path.resolve(__dirname, ".."), stdio: ["ignore", "pipe", "pipe"],
    env: { ...process.env, PATH: "/usr/bin:/bin", HOST: "127.0.0.1", PORT: String(port), CODEX_SESSIONS_DIR: codex,
      CLAUDE_PROJECTS_DIR: claude, CODEX_STATE_DB: path.join(root, "none.sqlite"), CODEX_SESSION_INDEX: path.join(root, "none.jsonl"),
      OBSERVER_DATA_DIR: path.join(root, "data"), OBSERVER_RUNTIME_DIR: path.join(root, "runtime"),
      OBSERVER_SOURCE_LOCATIONS_FILE: path.join(root, "missing-locations.json"), OBSERVER_DIALOGUE_SEARCH: "sqlite" },
  });
  let logs = "";
  server.stderr.on("data", (chunk) => { logs = (logs + chunk).slice(-10000); });
  server.stdout.on("data", () => {});
  let peak = 0;
  let polling = false;
  const measurements = [];
  const ps = promisify(execFile);
  const sample = async () => {
    if (polling) return;
    polling = true;
    try {
      const { stdout } = await ps("ps", ["-axo", "pid=,ppid=,rss="], { maxBuffer: 1024 * 1024 });
      const rows = stdout.trim().split("\n").map((line) => line.trim().split(/\s+/).map(Number));
      const pids = new Set([server.pid]);
      for (let depth = 0; depth < 5; depth++) for (const [pid, parent] of rows) if (pids.has(parent)) pids.add(pid);
      const rss = rows.reduce((total, [pid, , value]) => total + (pids.has(pid) ? value * 1024 : 0), 0);
      peak = Math.max(peak, rss);
    } finally { polling = false; }
  };
  const timer = setInterval(() => sample().catch(() => {}), 100);
  const url = `http://127.0.0.1:${port}`;
  async function request(route, options) {
    const response = await fetch(url + route, { ...options, headers: { "X-Observer-Request": "1", "Content-Type": "application/json" } });
    const result = await response.json();
    assert.equal(response.status, 200, `${route}: ${JSON.stringify(result)}`);
    return result;
  }
  async function measure(label, operation) {
    const started = performance.now();
    const result = await operation();
    await sample();
    const diagnostics = await request("/api/diagnostics");
    peak = Math.max(peak, diagnostics.combinedRss || 0);
    measurements.push({ label, durationMs: Math.round(performance.now() - started), rssMiB: +(diagnostics.combinedRss / 1048576).toFixed(1), peakMiB: +(peak / 1048576).toFixed(1) });
    console.log(JSON.stringify(measurements.at(-1)));
    return result;
  }
  try {
    for (let attempt = 0; ; attempt++) {
      try { await request("/api/diagnostics"); break; }
      catch { if (attempt > 100 || server.exitCode != null) throw new Error(`Server failed to start: ${logs}`); await delay(100); }
    }
    const summary = await measure("cold-summary", () => request("/api/observability"));
    assert.equal(summary.summary.tokens.effectiveTotal, records * 330, "large images must not hide trailing usage");
    await measure("warm-summary", () => request("/api/observability"));
    const page = await measure("latest-1000", () => request("/api/events?mode=raw&limit=1000"));
    const event = page.events.find((item) => item.callType === "Agent");
    assert.ok(event);
    const search = await measure("archive-substring-search", () => request(`/api/events?mode=raw&q=${encodeURIComponent("密集日志校验 799")}`));
    assert.equal(search.events.length, 1);
    await measure("replay", () => request("/api/sessions/dense-session/replay?limit=1000"));
    const analysis = await measure("turn-analysis", () => request("/api/sessions/dense-session/analysis"));
    assert.ok(analysis.turns.reduce((sum, turn) => sum + turn.tokens, 0) <= records * 330);
    assert.ok(analysis.performance.responses.length > 0, "large-record compaction must preserve response usage signals");
    assert.equal(analysis.performance.measuredResponses, 0, "missing response boundaries must not produce speed estimates");
    const baseline = await measure("performance-baseline", async () => {
      for (let attempt = 0; attempt < 350; attempt++) {
        const value = await request("/api/performance-baseline");
        if (value.status === "ready") return value;
        assert.notEqual(value.status, "error", "baseline scan must finish within the worker budget");
        await delay(100);
      }
      throw new Error("Baseline scan did not finish");
    });
    assert.equal(baseline.coverage.compactedLines, records);
    assert.equal(baseline.coverage.identifiedResponses, records);
    assert.equal(baseline.models.length, 0, "unfinished responses cannot establish a baseline");
    const daily = await measure("daily-history", () => request("/api/usage-history?source=claude"));
    assert.equal(daily.totals.requests, records);
    assert.equal(daily.totals.input + daily.totals.output, records * 330);
    assert.equal(daily.totals.unfinalized, records);
    assert.equal(daily.totals.outputTokS, null, "unfinished requests must not fabricate speed");
    await measure("historical-recalculation", () => request("/api/observability/recalculate", { method: "POST" }));
    await request("/api/diagnostics/recover", { method: "POST" });
    await measure("detail-after-worker-restart", () => request(`/api/events/detail?eventId=${encodeURIComponent(event.eventId)}`));
    await measure("persisted-summary-after-restart", () => request("/api/observability"));
    const controller = new AbortController();
    const cancelled = request("/api/observability/recalculate", { method: "POST", signal: controller.signal }).catch((error) => error);
    await delay(100);
    controller.abort();
    assert.equal((await cancelled).name, "AbortError");
    await measure("recovery-after-cancel", () => request("/api/observability"));
    assert.ok(peak < 300 * 1048576, `Combined RSS exceeded 300 MiB: ${peak / 1048576}`);
    console.log(JSON.stringify({ sourceMiB: +(bytes / 1048576).toFixed(1), records, expectedTokens: records * 330, peakMiB: +(peak / 1048576).toFixed(1), measurements }, null, 2));
  } finally {
    clearInterval(timer);
    server.kill("SIGTERM");
    await new Promise((resolve) => { if (server.exitCode != null) resolve(); else server.once("exit", resolve); });
    fs.rmSync(root, { recursive: true, force: true });
  }
}

main().catch((error) => { console.error(error); process.exitCode = 1; });
