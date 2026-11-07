const fs = require("fs");
const { createLiveSpeedEngine } = require("./live-speed-engine");
const { localDay } = require("./performance-score");
const { locationFor, qwenTranscriptKind } = require("./source-locations");
const { readConfiguredTier } = require("./execution-modes");
const { DEFAULT_HISTORY_MINUTES } = require("../shared/response-performance");
const { isDshCompressed, readZstdFrame, decodeZstdFrame } = require("./zstd-frames");
const { createCompactJsonDecoder } = require("./compact-json-record");

const speedFrame = (snapshot) => `event: speed\ndata: ${JSON.stringify(snapshot)}\n\n`;

function createLiveSpeedMonitor({ roots, clock = Date.now, maxFiles = 64, maxLineBytes = 128 * 1024, seedBytes = 1024 * 1024 } = {}) {
  let baseline = { status: "loading", models: [] };
  let baselineByModel = new Map();
  const engine = createLiveSpeedEngine({ clock, baselineLookup: (source, model) => baseline.today === localDay(clock()) ? baselineByModel.get(JSON.stringify([source, model])) : null });
  const files = new Map();
  const clients = new Map();
  const frames = new Map();
  let timer;
  let running;
  let closed = false;
  let began = false;
  let skippedLines = 0;
  let readErrors = 0;
  let omittedFiles = 0;
  let truncatedFiles = 0;
  const startedAt = clock();
  const activeRoots = (roots || []).filter((root) => !root.archive);
  function clearPending(state) {
    state.pending = Buffer.alloc(0);
    state.decoder?.close();
    state.decoder = null;
    state.skip = false;
  }
  function remove(state) {
    engine.stop(state.context);
    clearPending(state);
    files.delete(state.file);
  }

  function track(file, mtimeMs = clock(), seedExisting = !began) {
    if (closed || mtimeMs < clock() - 30 * 60_000) return;
    if (files.has(file)) { files.get(file).changedAt = Math.max(files.get(file).changedAt || 0, mtimeMs); return; }
    const root = locationFor(file, activeRoots);
    if (!root || (root.sourceType === "qwen" && qwenTranscriptKind(file) !== "active")) return;
    const compressed = root.sourceType === "dsh" && isDshCompressed(file);
    if (!file.endsWith(".jsonl") && !compressed) return;
    if (files.size >= maxFiles) {
      const oldest = [...files.values()].sort((a, b) => a.mtimeMs - b.mtimeMs)[0];
      if (oldest.mtimeMs >= mtimeMs) { omittedFiles++; return; }
      remove(oldest); omittedFiles++;
    }
    const configuredTier = readConfiguredTier(root.configFile);
    files.set(file, { file, source: root.sourceType, compressed, configuredTier, mtimeMs, offset: 0, pending: Buffer.alloc(0), skip: false, seedExisting, initialized: false, context: { file, configuredTier } });
  }
  function discover(records) {
    omittedFiles = 0;
    for (const record of records) track(record.file, record.mtimeMs, true);
  }
  function parseLine(state, line, seeded = true) {
    if (!line.length && !state.decoder) return;
    try {
      const compact = state.decoder?.finish();
      const value = compact ? compact.value : JSON.parse(line.toString("utf8"));
      engine.ingest(value, state.context, state.source, { seeded, compacted: compact?.truncated });
    }
    catch { skippedLines++; }
  }
  function consume(state, buffer, seeded) {
    let start = 0;
    while (start < buffer.length) {
      const newline = buffer.indexOf(10, start);
      const end = newline < 0 ? buffer.length : newline;
      if (!state.skip) {
        const part = buffer.subarray(start, end);
        try {
          if (!state.decoder && state.pending.length + part.length > maxLineBytes) {
            if (state.source !== "dsh") throw new Error("Line exceeds live read budget");
            state.decoder = createCompactJsonDecoder({ stringLimit: 8192 });
            state.decoder.write(state.pending);
            state.pending = Buffer.alloc(0);
          }
          if (state.decoder) state.decoder.write(part);
          else state.pending = Buffer.concat([state.pending, part]);
        } catch { clearPending(state); state.skip = true; skippedLines++; }
      }
      if (newline < 0) break;
      if (!state.skip) parseLine(state, state.pending, seeded);
      clearPending(state); start = newline + 1;
    }
  }
  async function readFrames(state, fd, size, budget) {
    const firstOffset = state.offset;
    const header = Buffer.allocUnsafe(8);
    let decodedBytes = 0;
    state.caughtUp = true;
    while (state.offset < size) {
      let frame;
      try { frame = readZstdFrame(fd, state.offset, size, header); }
      catch {
        readErrors++;
        state.offset = size;
        clearPending(state);
        engine.stop(state.context);
        break;
      }
      if (!frame) break;
      if (state.offset > firstOffset && Math.max(frame.end - firstOffset, decodedBytes) > budget) {
        state.caughtUp = false;
        break;
      }
      state.offset = frame.end;
      if (frame.skippable) continue;
      try {
        const buffer = await decodeZstdFrame(fd, frame);
        decodedBytes += buffer.length;
        consume(state, buffer, frame.end <= state.seedEnd);
      } catch {
        skippedLines++;
        clearPending(state);
        engine.stop(state.context);
      }
    }
    return Math.max(state.offset - firstOffset, decodedBytes);
  }
  async function readFile(state, budget) {
    let handle;
    try {
      handle = await fs.promises.open(state.file, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW | fs.constants.O_NONBLOCK);
      const stat = await handle.stat();
      if (!stat.isFile()) return 0;
      const identity = `${stat.dev}:${stat.ino}`;
      if (state.identity !== identity || stat.size < state.offset || (stat.size === state.offset && state.mtimeMs !== stat.mtimeMs)) {
        engine.stop(state.context);
        if (state.initialized) state.seedExisting = true;
        clearPending(state);
        state.initialized = false; state.context = { file: state.file, configuredTier: state.configuredTier };
      }
      state.identity = identity; state.mtimeMs = stat.mtimeMs;
      if (!state.initialized) {
        state.offset = state.compressed ? 0 : Math.max(0, stat.size - seedBytes);
        state.seedEnd = state.seedExisting ? stat.size : 0;
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
      if (state.compressed) return await readFrames(state, handle.fd, stat.size, Math.min(budget, 256 * 1024));
      const seeded = state.offset < state.seedEnd;
      const readEnd = seeded ? state.seedEnd : stat.size;
      const size = Math.min(budget, 256 * 1024, readEnd - state.offset);
      state.caughtUp = state.offset >= stat.size;
      if (size <= 0) return 0;
      const buffer = Buffer.alloc(size);
      const { bytesRead } = await handle.read(buffer, 0, size, state.offset);
      state.offset += bytesRead;
      consume(state, buffer.subarray(0, bytesRead), seeded);
      state.caughtUp = state.offset >= stat.size;
      return bytesRead;
    } catch (error) {
      if (error.code === "ENOENT") remove(state);
      else readErrors++;
      return 0;
    } finally { await handle?.close(); }
  }
  function snapshotRanges(windows) {
    const baselineState = { ...baseline };
    delete baselineState.models;
    const monitor = { startedAt, trackedFiles: files.size, maxFiles, skippedLines, readErrors, omittedFiles, truncatedFiles,
      warming: [...files.values()].some((state) => !state.initialized || !state.caughtUp) };
    const views = engine.snapshotRanges(windows);
    for (const view of views.values()) {
      view.performanceBaseline = baselineState;
      view.monitor = monitor;
    }
    return views;
  }
  function snapshot(historyMinutes = DEFAULT_HISTORY_MINUTES) {
    return snapshotRanges([historyMinutes]).get(historyMinutes);
  }
  async function tick() {
    if (closed) return;
    if (running) return running;
    began = true;
    running = (async () => {
      let budget = 2 * 1024 * 1024;
      for (const state of files.values()) {
        if (Math.max(state.mtimeMs, state.changedAt || 0) < clock() - 30 * 60_000) { remove(state); continue; }
        if (budget <= 0) break;
        budget -= await readFile(state, budget);
      }
      frames.clear();
      // Keep the engine's retention pruning active even with no connected charts.
      const windows = clients.size ? [...new Set(clients.values())] : [DEFAULT_HISTORY_MINUTES];
      for (const [minutes, view] of snapshotRanges(windows)) frames.set(minutes, speedFrame(view));
      for (const [res, minutes] of clients) {
        if (res.destroyed || res.writableLength > 256 * 1024) { clients.delete(res); res.end(); }
        else res.write(frames.get(minutes));
      }
    })().finally(() => { running = null; });
    return running;
  }
  function stream(req, res, historyMinutes = DEFAULT_HISTORY_MINUTES) {
    if (clients.size >= 8) { res.writeHead(503, { "Content-Type": "application/json" }); res.end('{"error":"Too many live monitors"}'); return; }
    res.writeHead(200, { "Content-Type": "text/event-stream", "Cache-Control": "no-store, no-transform", Connection: "keep-alive", "X-Accel-Buffering": "no" });
    res.write(`retry: 3000\n${frames.get(historyMinutes) || speedFrame(snapshot(historyMinutes))}`);
    clients.set(res, historyMinutes);
    res.on("close", () => clients.delete(res));
  }
  return { discover, notify: track, tick, snapshot, stream,
    setBaseline: (value) => { baseline = value; baselineByModel = new Map((value.models || []).map((row) => [JSON.stringify([row.sourceType, row.model]), row])); },
    start: () => { if (!timer) { tick(); timer = setInterval(tick, 1000); timer.unref?.(); } },
    close: () => {
      closed = true; clearInterval(timer);
      for (const res of clients.keys()) res.end();
      for (const state of files.values()) remove(state);
      clients.clear(); frames.clear();
    },
  };
}

module.exports = { createLiveSpeedMonitor };
