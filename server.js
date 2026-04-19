#!/usr/bin/env node
const http = require("http");
const fs = require("fs");
const path = require("path");
const os = require("os");
const { URL } = require("url");
const { spawnSync } = require("child_process");
const ObserverCore = require("./shared/observer-core");

const {
  applyEventSessionMeta: applyEventSessionMetaCore,
  applySessionTitleOverrides: applySessionTitleOverridesCore,
  buildSessionGroups: buildSessionGroupsCore,
  collectMeta: collectMetaCore,
  dedupeEvents: dedupeEventsCore,
  eventMatchesFilters: eventMatchesFiltersCore,
  eventMatchesMode: eventMatchesModeCore,
  mergeSessionMetaRecords: mergeSessionMetaRecordsCore,
  parseClaudeCodeLineToEvent: parseClaudeCodeLineToEventCore,
  parseCodexLineToEvent: parseCodexLineToEventCore,
  toPositiveInt: toPositiveIntCore,
  toTimeMs: toTimeMsCore,
} = ObserverCore;

const HOST = "127.0.0.1";
const PORT = process.env.PORT ? Number(process.env.PORT) : 8787;
const ROOT = __dirname;
const SESSIONS_DIR = process.env.CODEX_SESSIONS_DIR || path.join(os.homedir(), ".codex", "sessions");
const CLAUDE_PROJECTS_DIR = process.env.CLAUDE_PROJECTS_DIR || path.join(os.homedir(), ".claude", "projects");
const CLAUDE_SESSIONS_DIR = path.join(os.homedir(), ".claude", "sessions");
const CODEX_SESSION_INDEX = path.join(os.homedir(), ".codex", "session_index.jsonl");
const STATE_DB = process.env.CODEX_STATE_DB || path.join(os.homedir(), ".codex", "state_5.sqlite");
const DEFAULT_PAGE_SIZE = 250;
const MAX_PAGE_SIZE = 1000;
const INDEX_REFRESH_DEBOUNCE_MS = 400;
const INDEX_WARMUP_INTERVAL_MS = 3000;
const fileEventCache = new Map();
let aggregateCache = { key: "", events: [] };

// Read Claude Code version at startup
let claudeVersion = "unknown";
try {
  const proc = spawnSync("claude", ["--version"], { encoding: "utf8", timeout: 3000 });
  if (proc.status === 0 && proc.stdout.trim()) {
    claudeVersion = proc.stdout.trim();
  }
} catch { /* ignore */ }

// Read Codex version at startup
let codexVersion = "unknown";
try {
  const proc = spawnSync("codex", ["--version"], { encoding: "utf8", timeout: 3000 });
  if (proc.status === 0 && proc.stdout.trim()) {
    codexVersion = proc.stdout.trim();
  }
} catch { /* ignore */ }
const indexState = {
  events: [],
  aggregateKey: "",
  dirty: true,
  refreshTimer: null,
  lastBuiltAt: "",
  lastError: "",
};

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
};

function sendJson(res, status, data) {
  const body = JSON.stringify(data);
  res.writeHead(status, {
    "Content-Type": MIME[".json"],
    "Cache-Control": "no-store",
    "Content-Length": Buffer.byteLength(body),
  });
  res.end(body);
}

function listJsonlFiles(dir) {
  const out = [];
  if (!fs.existsSync(dir)) return out;
  const stack = [dir];
  while (stack.length) {
    const current = stack.pop();
    const entries = fs.readdirSync(current, { withFileTypes: true });
    for (const e of entries) {
      const full = path.join(current, e.name);
      if (e.isDirectory()) {
        // Skip subagent directories — their events are already merged into parent sessions
        if (e.name === "subagents") continue;
        stack.push(full);
      } else if (e.isFile() && full.endsWith(".jsonl")) {
        out.push(full);
      }
    }
  }
  return out;
}

function parseRequestFilters(searchParams) {
  return {
    mode: searchParams.get("mode") === "raw" ? "raw" : "observe",
    platform: searchParams.get("platform") || "",
    model: searchParams.get("model") || "",
    type: searchParams.get("type") || "",
    sessionId: searchParams.get("sessionId") || "",
    quickFilter: searchParams.get("quickFilter") || "all",
    tokenThreshold: toPositiveIntCore(searchParams.get("tokenThreshold"), 20000),
    query: (searchParams.get("q") || "").trim().toLowerCase(),
    startMs: toTimeMsCore(searchParams.get("start") || ""),
    endMs: toTimeMsCore(searchParams.get("end") || ""),
    order: searchParams.get("order") === "asc" ? "asc" : "desc",
    offset: toPositiveIntCore(searchParams.get("offset"), 0),
    limit: toPositiveIntCore(searchParams.get("limit"), DEFAULT_PAGE_SIZE, MAX_PAGE_SIZE),
  };
}

function resolveParserForFile(filePath) {
  if (filePath.includes("/.codex/")) return { parser: parseCodexLineToEventCore, sessionsDir: SESSIONS_DIR };
  if (filePath.includes("/.claude/")) return { parser: parseClaudeCodeLineToEventCore, sessionsDir: CLAUDE_PROJECTS_DIR };
  // Default to Codex parser for backwards compatibility
  return { parser: parseCodexLineToEventCore, sessionsDir: SESSIONS_DIR };
}

function loadThreadMetadataMap() {
  const map = new Map();
  if (!fs.existsSync(STATE_DB)) return map;

  const sql = "select id, coalesce(title, ''), coalesce(cwd, ''), coalesce(updated_at_ms, updated_at * 1000, 0) from threads;";
  const proc = spawnSync("sqlite3", ["-separator", "\t", STATE_DB, sql], { encoding: "utf8" });
  if (proc.status !== 0 || !proc.stdout) {
    if (proc.error?.code === "ENOENT") {
      console.warn("[sqlite3] Command not found — Codex session titles will be empty. Install sqlite3 to fix.");
    }
    return map;
  }

  const lines = proc.stdout.split(/\r?\n/).filter(Boolean);
  for (const line of lines) {
    const [id, title, cwd, updatedAtMs] = line.split("\t");
    if (!id) continue;
    map.set(id, {
      title: title || "",
      cwd: cwd || "",
      updatedAtMs: Number.isFinite(Number(updatedAtMs)) ? Number(updatedAtMs) : 0,
    });
  }
  return map;
}

function loadClaudeCodeSessionMeta() {
  const map = new Map();
  if (!fs.existsSync(CLAUDE_SESSIONS_DIR)) return map;

  const sessionFiles = fs.readdirSync(CLAUDE_SESSIONS_DIR).filter((f) => f.endsWith(".json"));
  for (const file of sessionFiles) {
    try {
      const data = JSON.parse(fs.readFileSync(path.join(CLAUDE_SESSIONS_DIR, file), "utf8"));
      if (data.sessionId) {
        map.set(data.sessionId, {
          title: data.name || "",
          cwd: data.cwd || "",
        });
      }
    } catch {
      // skip invalid files
    }
  }
  return map;
}

function loadCodexSessionIndexMeta() {
  const map = new Map();
  if (!fs.existsSync(CODEX_SESSION_INDEX)) return map;
  const lines = fs.readFileSync(CODEX_SESSION_INDEX, "utf8").split("\n").filter((l) => l.trim());
  for (const line of lines) {
    try {
      const obj = JSON.parse(line);
      const id = typeof obj.id === "string" ? obj.id.trim() : "";
      const title = typeof obj.thread_name === "string" ? obj.thread_name.trim() : "";
      if (!id || !title) continue;
      const updatedAtMs = Date.parse(obj.updated_at || "");
      map.set(id, mergeSessionMetaRecordsCore(map.get(id), {
        title,
        cwd: "",
        updatedAtMs: Number.isFinite(updatedAtMs) ? updatedAtMs : 0,
      }));
    } catch {
      // skip invalid lines
    }
  }
  return map;
}

function loadCodexSessionMeta() {
  const merged = loadThreadMetadataMap();
  const indexed = loadCodexSessionIndexMeta();
  for (const [id, meta] of indexed) {
    merged.set(id, mergeSessionMetaRecordsCore(merged.get(id), meta));
  }
  return merged;
}

function getPathSignature(target) {
  if (!fs.existsSync(target)) return "missing";
  const stat = fs.statSync(target);
  return `${stat.size}:${stat.mtimeMs}`;
}

function getStateSignature() {
  return getPathSignature(STATE_DB);
}

function computeAggregateSignature() {
  const codexFiles = listJsonlFiles(SESSIONS_DIR);
  const claudeFiles = listJsonlFiles(CLAUDE_PROJECTS_DIR);
  const files = [...codexFiles, ...claudeFiles];
  const stateSignature = getStateSignature();
  const codexIndexSignature = getPathSignature(CODEX_SESSION_INDEX);
  const parts = files.map((file) => {
    const stat = fs.statSync(file);
    return `${file}:${stat.size}:${stat.mtimeMs}`;
  });
  return {
    files,
    stateSignature,
    aggregateKey: `${stateSignature}|${codexIndexSignature}|${parts.join("|")}`,
  };
}

function parseFileEvents(file, stateSignature, threadMeta) {
  const stat = fs.statSync(file);
  const { parser, sessionsDir: srcDir } = resolveParserForFile(file);
  const cached = fileEventCache.get(file);
  const canAppendIncrementally =
    cached &&
    cached.stateSignature === stateSignature &&
    stat.size >= cached.size &&
    cached.context;

  if (cached && cached.stateSignature === stateSignature && cached.size === stat.size && cached.mtimeMs === stat.mtimeMs) {
    return cached.events;
  }

  const context = canAppendIncrementally
    ? { ...cached.context, sourceFile: file }
    : { model: "unknown", sessionId: "unknown", sourceFile: file, cwd: "", sessionTitle: "" };
  const parsed = canAppendIncrementally ? cached.events.slice() : [];
  let tailBuffer = canAppendIncrementally ? cached.tailBuffer || "" : "";
  let text = "";

  if (canAppendIncrementally && stat.size > cached.size) {
    const fd = fs.openSync(file, "r");
    try {
      const length = stat.size - cached.size;
      const buf = Buffer.alloc(length);
      fs.readSync(fd, buf, 0, length, cached.size);
      text = buf.toString("utf8");
    } finally {
      fs.closeSync(fd);
    }
  } else if (!canAppendIncrementally) {
    text = fs.readFileSync(file, "utf8");
  }

  const chunk = `${tailBuffer}${text}`;
  const lines = chunk.split(/\r?\n/);
  tailBuffer = lines.pop() || "";

  const pushLine = (line) => {
    if (!line) return;
    try {
      const obj = JSON.parse(line);
      const evtOrArray = parser(obj, context);
      const events = Array.isArray(evtOrArray) ? evtOrArray : [evtOrArray].filter(Boolean);
      const titleStrategy = parser === parseCodexLineToEventCore ? "always" : "missing-only";
      for (const evt of events) {
        const meta = threadMeta.get(evt.sessionId);
        if (meta) {
          applyEventSessionMetaCore(evt, meta, { titleStrategy });
        }
        parsed.push(evt);
      }
    } catch {
      // skip invalid lines
    }
  };

  for (const line of lines) pushLine(line);
  if (tailBuffer && stat.size > 0) {
    const lastChar = text ? text[text.length - 1] : "";
    const fileEndedWithNewline = lastChar === "\n";
    if (fileEndedWithNewline) {
      pushLine(tailBuffer);
      tailBuffer = "";
    }
  }

  fileEventCache.set(file, {
    stateSignature,
    size: stat.size,
    mtimeMs: stat.mtimeMs,
    tailBuffer,
    context: { ...context },
    events: parsed,
  });
  return parsed;
}

function computeAggregate() {
  const threadMeta = loadCodexSessionMeta();
  const claudeMeta = loadClaudeCodeSessionMeta();
  // Merge Claude Code metadata into threadMeta (no key collisions expected since session IDs are unique)
  for (const [id, meta] of claudeMeta) {
    if (!threadMeta.has(id)) threadMeta.set(id, meta);
  }
  const { files, stateSignature, aggregateKey } = computeAggregateSignature();
  const liveFiles = new Set(files);
  for (const cachedFile of fileEventCache.keys()) {
    if (!liveFiles.has(cachedFile)) fileEventCache.delete(cachedFile);
  }
  if (aggregateCache.key === aggregateKey) {
    return { aggregateKey, events: aggregateCache.events };
  }

  const all = [];
  for (const file of files) {
    all.push(...parseFileEvents(file, stateSignature, threadMeta));
  }
  all.sort((a, b) => (a.time < b.time ? -1 : 1));
  const deduped = dedupeEventsCore(all);
  aggregateCache = { key: aggregateKey, events: deduped };
  return { aggregateKey, events: deduped };
}

function scheduleIndexRefresh(reason = "unknown") {
  indexState.dirty = true;
  if (indexState.refreshTimer) clearTimeout(indexState.refreshTimer);
  indexState.refreshTimer = setTimeout(() => {
    indexState.refreshTimer = null;
    try {
      refreshIndex(reason);
    } catch {
      // leave dirty state to retry on next request/tick
    }
  }, INDEX_REFRESH_DEBOUNCE_MS);
}

function refreshIndex(reason = "manual") {
  try {
    const built = computeAggregate();
    indexState.events = built.events;
    indexState.aggregateKey = built.aggregateKey;
    indexState.lastBuiltAt = new Date().toISOString();
    indexState.lastError = "";
    indexState.dirty = false;
    return indexState.events;
  } catch (err) {
    indexState.lastError = String(err);
    throw err;
  }
}

function ensureIndexReady() {
  const { aggregateKey } = computeAggregateSignature();
  if (!indexState.events.length || indexState.dirty || indexState.aggregateKey !== aggregateKey) {
    refreshIndex(indexState.events.length ? "dirty-read" : "cold-start");
  }
  return { events: indexState.events, currentAggregateKey: aggregateKey };
}

function watchPath(target, listener) {
  if (!fs.existsSync(target)) return null;
  try {
    return fs.watch(target, { recursive: true }, listener);
  } catch {
    try {
      return fs.watch(target, listener);
    } catch {
      return null;
    }
  }
}

function startIndexWatchers() {
  const sessionWatcher = watchPath(SESSIONS_DIR, () => scheduleIndexRefresh("sessions-watch"));
  const stateWatcher = watchPath(STATE_DB, () => scheduleIndexRefresh("state-watch"));
  const claudeWatcher = watchPath(CLAUDE_PROJECTS_DIR, () => scheduleIndexRefresh("claude-watch"));
  if (!sessionWatcher) {
    console.warn(`Session watcher unavailable for ${SESSIONS_DIR}, fallback warmup tick enabled.`);
  }
  if (!stateWatcher && fs.existsSync(STATE_DB)) {
    console.warn(`State DB watcher unavailable for ${STATE_DB}, fallback warmup tick enabled.`);
  }
  if (!claudeWatcher) {
    console.warn(`Claude Code watcher unavailable for ${CLAUDE_PROJECTS_DIR}, fallback warmup tick enabled.`);
  }
  setInterval(() => {
    if (indexState.dirty) {
      try {
        refreshIndex("warmup-tick");
      } catch {
        // keep retrying lazily
      }
    }
  }, INDEX_WARMUP_INTERVAL_MS).unref();
}

function queryEvents(filters) {
  const ready = ensureIndexReady();
  const allEvents = ready.events;
  const visibleEvents = allEvents.filter((event) => eventMatchesModeCore(event, filters.mode));
  const meta = collectMetaCore(visibleEvents);
  const matched = visibleEvents.filter((event) => eventMatchesFiltersCore(event, filters));
  matched.sort((a, b) => {
    const am = toTimeMsCore(a.time) ?? 0;
    const bm = toTimeMsCore(b.time) ?? 0;
    return filters.order === "asc" ? am - bm : bm - am;
  });
  const paged = matched.slice(filters.offset, filters.offset + filters.limit);
  return {
    generatedAt: new Date().toISOString(),
    sessionsDir: SESSIONS_DIR,
    mode: filters.mode,
    claudeVersion,
    codexVersion,
    index: {
      dirty: indexState.dirty,
      lastBuiltAt: indexState.lastBuiltAt,
      lastError: indexState.lastError,
      aggregateKey: indexState.aggregateKey,
      currentAggregateKey: ready.currentAggregateKey,
    },
    totalVisible: visibleEvents.length,
    totalMatching: matched.length,
    sessions: buildSessionGroupsCore(matched),
    meta,
    page: {
      offset: filters.offset,
      limit: filters.limit,
      hasMore: filters.offset + paged.length < matched.length,
    },
    events: paged,
  };
}

function serveStatic(reqPath, res) {
  let filePath = reqPath === "/" ? "/index.html" : reqPath;
  filePath = path.normalize(filePath).replace(/^(\.\.[/\\])+/, "");
  const abs = path.join(ROOT, filePath);
  if (!abs.startsWith(ROOT)) {
    res.writeHead(403);
    return res.end("Forbidden");
  }
  if (!fs.existsSync(abs) || fs.statSync(abs).isDirectory()) {
    res.writeHead(404);
    return res.end("Not Found");
  }
  const ext = path.extname(abs);
  res.writeHead(200, { "Content-Type": MIME[ext] || "application/octet-stream" });
  fs.createReadStream(abs).pipe(res);
}

function loadClaudeSessionIndex() {
  const claudeSessionsDir = path.join(os.homedir(), ".claude", "sessions");
  const map = new Map();
  if (!fs.existsSync(claudeSessionsDir)) return map;
  const files = fs.readdirSync(claudeSessionsDir).filter((file) => file.endsWith(".json"));
  for (const file of files) {
    try {
      const data = JSON.parse(fs.readFileSync(path.join(claudeSessionsDir, file), "utf8"));
      if (data.sessionId && typeof data.name === "string" && data.name.trim()) {
        map.set(data.sessionId, data.name.trim());
      }
    } catch {
      // skip
    }
  }
  return map;
}

function querySessions() {
  const ready = ensureIndexReady();
  const groups = buildSessionGroupsCore(ready.events);

  applySessionTitleOverridesCore(groups, loadClaudeSessionIndex(), "claude");

  // Group by cwd
  const cwdGroups = new Map();
  for (const g of groups) {
    const cwd = g.cwd || "unknown";
    if (!cwdGroups.has(cwd)) cwdGroups.set(cwd, []);
    cwdGroups.get(cwd).push(g);
  }

  return {
    generatedAt: new Date().toISOString(),
    total: groups.length,
    groups: Object.fromEntries(cwdGroups),
  };
}

function findClaudeSessionFile(sessionId) {
  const claudeSessionsDir = path.join(os.homedir(), ".claude", "sessions");
  if (!fs.existsSync(claudeSessionsDir)) return null;
  const files = fs.readdirSync(claudeSessionsDir).filter((f) => f.endsWith(".json"));
  for (const file of files) {
    try {
      const data = JSON.parse(fs.readFileSync(path.join(claudeSessionsDir, file), "utf8"));
      if (data.sessionId === sessionId) return path.join(claudeSessionsDir, file);
    } catch {
      // skip
    }
  }
  return null;
}

function findClaudeTranscriptFiles(sessionId) {
  // Find JSONL files in ~/.claude/projects/**/ that match the sessionId
  const files = [];
  if (!fs.existsSync(CLAUDE_PROJECTS_DIR)) return files;
  const projects = fs.readdirSync(CLAUDE_PROJECTS_DIR);
  for (const project of projects) {
    const projectDir = path.join(CLAUDE_PROJECTS_DIR, project);
    if (!fs.statSync(projectDir).isDirectory()) continue;
    try {
      const entries = fs.readdirSync(projectDir, { withFileTypes: true });
      for (const e of entries) {
        if (e.isFile() && e.name.startsWith(sessionId) && e.name.endsWith(".jsonl")) {
          files.push(path.join(projectDir, e.name));
        } else if (e.isDirectory()) {
          // Check subagent directories
          try {
            const subEntries = fs.readdirSync(path.join(projectDir, e.name), { withFileTypes: true });
            for (const se of subEntries) {
              if (se.isFile() && se.name.endsWith(".jsonl")) {
                files.push(path.join(projectDir, e.name, se.name));
              }
            }
          } catch {
            // skip
          }
        }
      }
    } catch {
      // skip
    }
  }
  return files;
}

function findCodexSessionFiles(sessionId) {
  const codexSessionsDir = path.join(os.homedir(), ".codex", "sessions");
  if (!fs.existsSync(codexSessionsDir)) return [];
  const files = [];
  // Recursively search for JSONL files matching the sessionId
  const searchDir = (dir) => {
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        searchDir(fullPath);
      } else if (entry.isFile() && entry.name.includes(sessionId) && entry.name.endsWith(".jsonl")) {
        files.push(fullPath);
      }
    }
  };
  searchDir(codexSessionsDir);
  return files;
}

function updateCodexSessionIndex(sessionId, newName) {
  if (!fs.existsSync(CODEX_SESSION_INDEX)) {
    // Create new index file with the session entry
    const entry = JSON.stringify({
      id: sessionId,
      thread_name: newName,
      updated_at: new Date().toISOString(),
    });
    fs.writeFileSync(CODEX_SESSION_INDEX, entry + "\n", "utf8");
    return true;
  }
  const lines = fs.readFileSync(CODEX_SESSION_INDEX, "utf8").split("\n").filter((l) => l.trim());
  const updated = [];
  let found = false;
  for (const line of lines) {
    try {
      const obj = JSON.parse(line);
      if (obj.id === sessionId) {
        obj.thread_name = newName;
        obj.updated_at = new Date().toISOString();
        found = true;
      }
      updated.push(JSON.stringify(obj));
    } catch {
      updated.push(line);
    }
  }
  // If not found, append a new entry
  if (!found) {
    updated.push(JSON.stringify({
      id: sessionId,
      thread_name: newName,
      updated_at: new Date().toISOString(),
    }));
  }
  fs.writeFileSync(CODEX_SESSION_INDEX, updated.join("\n") + "\n", "utf8");
  return true;
}

function escapeSqliteString(value) {
  return `'${String(value || "").replace(/'/g, "''")}'`;
}

function updateCodexThreadTitle(sessionId, newName) {
  if (!fs.existsSync(STATE_DB)) return false;
  const nowMs = Date.now();
  const nowSec = Math.floor(nowMs / 1000);
  const sql = [
    `update threads set title = ${escapeSqliteString(newName)}, updated_at = ${nowSec}, updated_at_ms = ${nowMs}`,
    `where id = ${escapeSqliteString(sessionId)};`,
    "select changes();",
  ].join(" ");
  const proc = spawnSync("sqlite3", [STATE_DB, sql], { encoding: "utf8" });
  if (proc.status !== 0) return false;
  const changes = Number.parseInt((proc.stdout || "").trim().split(/\r?\n/).pop() || "0", 10);
  return Number.isFinite(changes) && changes > 0;
}

function removeCodexSessionFromIndex(sessionId) {
  if (!fs.existsSync(CODEX_SESSION_INDEX)) return;
  const lines = fs.readFileSync(CODEX_SESSION_INDEX, "utf8").split("\n").filter((l) => l.trim());
  const updated = lines.filter((line) => {
    try {
      const obj = JSON.parse(line);
      return obj.id !== sessionId;
    } catch {
      return true;
    }
  });
  fs.writeFileSync(CODEX_SESSION_INDEX, updated.join("\n") + (updated.length > 0 ? "\n" : ""), "utf8");
}

function deleteClaudeSessionFiles(sessionId) {
  const home = os.homedir();
  const dirs = [
    { dir: path.join(home, ".claude", "session-env", sessionId), recursive: true },
    { dir: path.join(home, ".claude", "tasks", sessionId), recursive: true },
    { dir: path.join(home, ".claude", "file-history", sessionId), recursive: true },
    { dir: path.join(home, ".claude", "debug", `${sessionId}.txt`), recursive: false },
    { dir: path.join(home, ".claude", "shell-snapshots", `${sessionId}.sh`), recursive: false },
  ];

  // Find and delete transcript files
  if (fs.existsSync(CLAUDE_PROJECTS_DIR)) {
    const projects = fs.readdirSync(CLAUDE_PROJECTS_DIR);
    for (const project of projects) {
      const projectDir = path.join(CLAUDE_PROJECTS_DIR, project);
      if (!fs.statSync(projectDir).isDirectory()) continue;
      try {
        const entries = fs.readdirSync(projectDir, { withFileTypes: true });
        for (const e of entries) {
          if (e.isFile() && e.name.startsWith(sessionId) && e.name.endsWith(".jsonl")) {
            fs.unlinkSync(path.join(projectDir, e.name));
          }
        }
      } catch {
        // skip
      }
    }
  }

  for (const { dir, recursive } of dirs) {
    try {
      if (recursive) {
        if (fs.existsSync(dir)) fs.rmSync(dir, { recursive: true, force: true });
      } else {
        if (fs.existsSync(dir)) fs.unlinkSync(dir);
      }
    } catch {
      // skip
    }
  }
}

const server = http.createServer((req, res) => {
  const u = new URL(req.url, `http://${req.headers.host}`);

  if (u.pathname === "/api/events") {
    try {
      const filters = parseRequestFilters(u.searchParams);
      return sendJson(res, 200, queryEvents(filters));
    } catch (err) {
      return sendJson(res, 500, { error: String(err), index: indexState });
    }
  }

  if (u.pathname === "/api/sessions" && req.method === "GET") {
    try {
      return sendJson(res, 200, querySessions());
    } catch (err) {
      return sendJson(res, 500, { error: String(err) });
    }
  }

  if (u.pathname === "/api/sessions/rename" && req.method === "POST") {
    let body = "";
    req.on("data", (chunk) => {
      body += chunk;
    });
    req.on("end", () => {
      try {
        const { sessionId, newName } = JSON.parse(body);
        if (!sessionId || !newName) return sendJson(res, 400, { error: "sessionId and newName required" });

        // Try Claude Code first
        const claudeFile = findClaudeSessionFile(sessionId);
        if (claudeFile) {
          const data = JSON.parse(fs.readFileSync(claudeFile, "utf8"));
          data.name = newName;
          fs.writeFileSync(claudeFile, JSON.stringify(data), "utf8");
          scheduleIndexRefresh("session-renamed");
          return sendJson(res, 200, { success: true, sessionId, name: newName, platform: "claude" });
        }

        // Try Codex
        const codexDbUpdated = updateCodexThreadTitle(sessionId, newName);
        const codexIndexUpdated = updateCodexSessionIndex(sessionId, newName);
        if (codexDbUpdated || codexIndexUpdated) {
          scheduleIndexRefresh("session-renamed");
          return sendJson(res, 200, { success: true, sessionId, name: newName, platform: "codex" });
        }

        return sendJson(res, 404, { error: "Session not found" });
      } catch (err) {
        return sendJson(res, 500, { error: String(err) });
      }
    });
    return;
  }

  // Batch delete sessions
  if (u.pathname === "/api/sessions/batch-delete" && req.method === "POST") {
    let body = "";
    req.on("data", (chunk) => {
      body += chunk;
    });
    req.on("end", () => {
      try {
        const { sessionIds } = JSON.parse(body);
        if (!Array.isArray(sessionIds) || sessionIds.length === 0) {
          return sendJson(res, 400, { error: "sessionIds array required" });
        }

        const results = [];
        for (const sessionId of sessionIds) {
          try {
            // Try Claude Code deletion
            const claudeFile = findClaudeSessionFile(sessionId);
            const claudeTranscripts = findClaudeTranscriptFiles(sessionId);

            if (claudeFile || claudeTranscripts.length > 0) {
              if (claudeFile && fs.existsSync(claudeFile)) fs.unlinkSync(claudeFile);
              deleteClaudeSessionFiles(sessionId);
              results.push({ sessionId, success: true, platform: "claude" });
              continue;
            }

            // Try Codex deletion
            const codexFiles = findCodexSessionFiles(sessionId);
            if (codexFiles.length > 0) {
              for (const f of codexFiles) {
                if (fs.existsSync(f)) fs.unlinkSync(f);
              }
              removeCodexSessionFromIndex(sessionId);
              results.push({ sessionId, success: true, platform: "codex" });
              continue;
            }

            results.push({ sessionId, success: false, error: "not found" });
          } catch (err) {
            results.push({ sessionId, success: false, error: String(err) });
          }
        }

        scheduleIndexRefresh("batch-delete");
        const deletedCount = results.filter((r) => r.success).length;
        return sendJson(res, 200, { success: true, total: sessionIds.length, deleted: deletedCount, results });
      } catch (err) {
        return sendJson(res, 500, { error: String(err) });
      }
    });
    return;
  }

  if (u.pathname.startsWith("/api/sessions/") && req.method === "DELETE") {
    const sessionId = u.pathname.split("/").pop();
    if (!sessionId) return sendJson(res, 400, { error: "sessionId required" });
    try {
      // Try Claude Code deletion
      const claudeFile = findClaudeSessionFile(sessionId);
      const claudeTranscripts = findClaudeTranscriptFiles(sessionId);

      if (claudeFile || claudeTranscripts.length > 0) {
        // Delete session metadata JSON if exists
        if (claudeFile && fs.existsSync(claudeFile)) fs.unlinkSync(claudeFile);
        // Delete transcript JSONL files and other session data
        deleteClaudeSessionFiles(sessionId);
        scheduleIndexRefresh("session-deleted");
        return sendJson(res, 200, { success: true, sessionId, platform: "claude" });
      }

      // Try Codex deletion
      const codexFiles = findCodexSessionFiles(sessionId);
      if (codexFiles.length > 0) {
        for (const f of codexFiles) {
          if (fs.existsSync(f)) fs.unlinkSync(f);
        }
        removeCodexSessionFromIndex(sessionId);
        scheduleIndexRefresh("session-deleted");
        return sendJson(res, 200, { success: true, sessionId, platform: "codex" });
      }

      return sendJson(res, 404, { error: "Session not found" });
    } catch (err) {
      return sendJson(res, 500, { error: String(err) });
    }
  }

  return serveStatic(u.pathname, res);
});

server.listen(PORT, HOST, () => {
  console.log(`Session Observer running at http://${HOST}:${PORT}`);
  console.log(`Codex sessions: ${SESSIONS_DIR}`);
  console.log(`Claude Code sessions: ${CLAUDE_PROJECTS_DIR}`);
  startIndexWatchers();
  try {
    refreshIndex("startup");
  } catch (err) {
    console.error(`Initial index build failed: ${err}`);
  }
});
