const fs = require("fs");
const { createLiveSpeedEngine } = require("./live-speed-engine");
const { localDay } = require("./performance-score");
const { locationFor } = require("./source-locations");
const { readConfiguredTier } = require("./execution-modes");

function createLiveSpeedMonitor({ roots, clock = Date.now, maxFiles = 64, maxLineBytes = 128 * 1024, seedBytes = 1024 * 1024 } = {}) {
  let baseline = { status: "loading", models: [] };
  let baselineByModel = new Map();
  const engine = createLiveSpeedEngine({ clock, baselineLookup: (source, model) => baseline.today === localDay(clock()) ? baselineByModel.get(JSON.stringify([source, model])) : null });
  const files = new Map();
  const clients = new Set();
  let timer;
  let running;
  let closed = false;
  let cached;
  let skippedLines = 0;
  let readErrors = 0;
  let omittedFiles = 0;
  let truncatedFiles = 0;
  const startedAt = clock();
  const activeRoots = (roots || []).filter((root) => !root.archive);

  function track(file, mtimeMs = clock()) {
    if (closed || mtimeMs < clock() - 30 * 60_000) return;
    if (files.has(file)) { files.get(file).changedAt = Math.max(files.get(file).changedAt || 0, mtimeMs); return; }
    const root = file.endsWith(".jsonl") && locationFor(file, activeRoots);
    if (!root) return;
    if (files.size >= maxFiles) {
      const oldest = [...files.values()].sort((a, b) => a.mtimeMs - b.mtimeMs)[0];
      if (oldest.mtimeMs >= mtimeMs) { omittedFiles++; return; }
      engine.stop(oldest.context);
      files.delete(oldest.file); omittedFiles++;
    }
    const configuredTier = readConfiguredTier(root.configFile);
    files.set(file, { file, source: root.sourceType, configuredTier, mtimeMs, offset: 0, pending: Buffer.alloc(0), skip: false, initialized: false, context: { file, configuredTier } });
  }
  function discover(records) {
    omittedFiles = 0;
    for (const record of records) track(record.file, record.mtimeMs);
  }
  function parseLine(state, line) {
    if (!line.length) return;
    try { engine.ingest(JSON.parse(line.toString("utf8")), state.context, state.source); }
    catch { skippedLines++; }
  }
  function consume(state, buffer) {
    let start = 0;
    while (start < buffer.length) {
      const newline = buffer.indexOf(10, start);
      const end = newline < 0 ? buffer.length : newline;
      if (!state.skip) {
        const part = buffer.subarray(start, end);
        if (state.pending.length + part.length > maxLineBytes) {
          state.skip = true; state.pending = Buffer.alloc(0); skippedLines++;
        } else state.pending = Buffer.concat([state.pending, part]);
      }
      if (newline < 0) break;
      if (!state.skip) parseLine(state, state.pending);
      state.pending = Buffer.alloc(0); state.skip = false; start = newline + 1;
    }
  }
  async function readFile(state, budget) {
    let handle;
    try {
      handle = await fs.promises.open(state.file, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW);
      const stat = await handle.stat();
      if (!stat.isFile()) return 0;
      const identity = `${stat.dev}:${stat.ino}`;
      if (state.identity !== identity || stat.size < state.offset || (stat.size === state.offset && state.mtimeMs !== stat.mtimeMs)) {
        engine.stop(state.context);
        state.initialized = false; state.pending = Buffer.alloc(0); state.context = { file: state.file, configuredTier: state.configuredTier }; state.skip = false;
      }
      state.identity = identity; state.mtimeMs = stat.mtimeMs;
      if (!state.initialized) {
        state.offset = Math.max(0, stat.size - seedBytes);
        if (state.offset > 0) {
          truncatedFiles++;
          const header = Buffer.alloc(Math.min(maxLineBytes, stat.size));
          const read = await handle.read(header, 0, header.length, 0);
          const newline = header.indexOf(10, 0);
          if (newline >= 0 && newline < read.bytesRead) parseLine(state, header.subarray(0, newline));
          const preceding = Buffer.alloc(1);
          await handle.read(preceding, 0, 1, state.offset - 1);
          state.skip = preceding[0] !== 10;
        }
        state.initialized = true;
      }
      const size = Math.min(budget, 256 * 1024, stat.size - state.offset);
      state.caughtUp = state.offset >= stat.size;
      if (size <= 0) return 0;
      const buffer = Buffer.alloc(size);
      const { bytesRead } = await handle.read(buffer, 0, size, state.offset);
      state.offset += bytesRead;
      consume(state, buffer.subarray(0, bytesRead));
      state.caughtUp = state.offset >= stat.size;
      return bytesRead;
    } catch (error) {
      if (error.code === "ENOENT") { engine.stop(state.context); files.delete(state.file); }
      else readErrors++;
      return 0;
    } finally { await handle?.close(); }
  }
  function snapshot() {
    const baselineState = { ...baseline };
    delete baselineState.models;
    return { ...engine.snapshot(), performanceBaseline: baselineState, monitor: { startedAt, trackedFiles: files.size, maxFiles, skippedLines, readErrors, omittedFiles, truncatedFiles,
      warming: [...files.values()].some((state) => !state.initialized || !state.caughtUp) } };
  }
  async function tick() {
    if (closed) return;
    if (running) return running;
    running = (async () => {
      let budget = 2 * 1024 * 1024;
      for (const state of files.values()) {
        if (Math.max(state.mtimeMs, state.changedAt || 0) < clock() - 30 * 60_000) { engine.stop(state.context); files.delete(state.file); continue; }
        if (budget <= 0) break;
        budget -= await readFile(state, budget);
      }
      cached = snapshot();
      const data = `event: speed\ndata: ${JSON.stringify(cached)}\n\n`;
      for (const res of clients) {
        if (res.destroyed || res.writableLength > 256 * 1024) { clients.delete(res); res.end(); }
        else res.write(data);
      }
    })().finally(() => { running = null; });
    return running;
  }
  function stream(req, res) {
    if (clients.size >= 8) { res.writeHead(503, { "Content-Type": "application/json" }); res.end('{"error":"Too many live monitors"}'); return; }
    res.writeHead(200, { "Content-Type": "text/event-stream", "Cache-Control": "no-store, no-transform", Connection: "keep-alive", "X-Accel-Buffering": "no" });
    res.write(`retry: 3000\nevent: speed\ndata: ${JSON.stringify(cached || snapshot())}\n\n`);
    clients.add(res);
    res.on("close", () => clients.delete(res));
  }
  return { discover, notify: track, tick, snapshot, stream,
    setBaseline: (value) => { baseline = value; baselineByModel = new Map((value.models || []).map((row) => [JSON.stringify([row.sourceType, row.model]), row])); },
    start: () => { if (!timer) { tick(); timer = setInterval(tick, 1000); timer.unref?.(); } },
    close: () => { closed = true; clearInterval(timer); for (const res of clients) res.end(); clients.clear(); files.clear(); },
  };
}

module.exports = { createLiveSpeedMonitor };
