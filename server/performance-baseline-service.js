const { localDay } = require("./performance-score");

function createPerformanceBaselineService({ executor, onUpdate, clock = Date.now }) {
  let state = { status: "loading", models: [], coverage: null, generatedAt: null };
  let running, timer, initial, closed = false;
  const publish = (next) => { if (!closed) { state = next; onUpdate(state); } };
  function refresh() {
    if (closed || running) return running;
    publish({ ...state, status: "loading", error: null });
    running = executor.run("performanceBaseline").then((value) => publish(value))
      .catch(() => publish({ ...state, status: "error", error: "历史基线更新失败，可重试；已有缓存仍保留。" }))
      .finally(() => { running = null; });
    return running;
  }
  return { refresh, state: () => state,
    start: () => {
      initial = setTimeout(refresh, 1500); initial.unref?.();
      timer = setInterval(() => { if (state.today !== localDay(clock()) || clock() - (state.generatedAt || 0) >= 600000) refresh(); }, 60000); timer.unref?.();
    },
    close: () => { closed = true; clearTimeout(initial); clearInterval(timer); },
  };
}

module.exports = { createPerformanceBaselineService };
