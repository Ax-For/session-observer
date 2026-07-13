#!/usr/bin/env node
/**
 * Session metadata loading from Codex (SQLite DB + index) and Claude Code (session JSON).
 */
const fs = require("fs");
const path = require("path");
const { spawnSync } = require("child_process");
const config = require("./config");

function loadSessionTitleOverrides() {
  try {
    const payload = JSON.parse(fs.readFileSync(config.SESSION_TITLE_OVERRIDES_FILE, "utf8"));
    const titles = payload?.titles && typeof payload.titles === "object" ? payload.titles : {};
    return new Map(Object.entries(titles).flatMap(([sessionId, value]) => {
      const title = typeof value === "string" ? value.trim() : String(value?.title || "").trim();
      if (!sessionId || !title) return [];
      return [[sessionId, {
        title,
        updatedAtMs: Number(value?.updatedAtMs) || 0,
        explicitTitle: true,
      }]];
    }));
  } catch {
    return new Map();
  }
}

function writeSessionTitleOverrides(overrides) {
  fs.mkdirSync(path.dirname(config.SESSION_TITLE_OVERRIDES_FILE), { recursive: true });
  const titles = Object.fromEntries([...overrides.entries()].map(([sessionId, value]) => [sessionId, value]));
  const payload = JSON.stringify({ version: 1, titles }, null, 2);
  const temporaryFile = `${config.SESSION_TITLE_OVERRIDES_FILE}.tmp`;
  fs.writeFileSync(temporaryFile, `${payload}\n`, "utf8");
  fs.renameSync(temporaryFile, config.SESSION_TITLE_OVERRIDES_FILE);
}

function markSessionTitleOverride(sessionId, title) {
  const normalizedTitle = String(title || "").trim();
  if (!sessionId || !normalizedTitle) return;
  const overrides = loadSessionTitleOverrides();
  overrides.set(sessionId, { title: normalizedTitle, updatedAtMs: Date.now() });
  writeSessionTitleOverrides(overrides);
}

function removeSessionTitleOverride(sessionId) {
  if (!sessionId) return;
  const overrides = loadSessionTitleOverrides();
  if (!overrides.delete(sessionId)) return;
  writeSessionTitleOverrides(overrides);
}

/**
 * Load Codex thread metadata from the state SQLite database.
 */
function loadThreadMetadataMap() {
  const map = new Map();
  if (!fs.existsSync(config.STATE_DB)) return map;

  const sql = "select id, coalesce(title, ''), coalesce(cwd, ''), coalesce(updated_at_ms, updated_at * 1000, 0) from threads;";
  const proc = spawnSync("sqlite3", ["-separator", "\t", config.STATE_DB, sql], { encoding: "utf8" });
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

/**
 * Load Claude Code session metadata from ~/.claude/sessions/*.json.
 */
function loadClaudeCodeSessionMeta() {
  const map = new Map();
  if (!fs.existsSync(config.CLAUDE_SESSIONS_DIR)) return map;

  const sessionFiles = fs.readdirSync(config.CLAUDE_SESSIONS_DIR).filter((f) => f.endsWith(".json"));
  for (const file of sessionFiles) {
    try {
      const fullPath = path.join(config.CLAUDE_SESSIONS_DIR, file);
      const data = JSON.parse(fs.readFileSync(fullPath, "utf8"));
      const stat = fs.statSync(fullPath);
      if (data.sessionId) {
        map.set(data.sessionId, {
          title: data.name || "",
          cwd: data.cwd || "",
          updatedAtMs: Number.isFinite(stat.mtimeMs) ? stat.mtimeMs : 0,
          explicitTitle: typeof data.name === "string" && Boolean(data.name.trim()),
        });
      }
    } catch {
      // skip invalid files
    }
  }
  return map;
}

/**
 * Load Codex session index metadata from session_index.jsonl.
 */
function loadCodexSessionIndexMeta(mergeSessionMetaRecordsCore) {
  const map = new Map();
  if (!fs.existsSync(config.CODEX_SESSION_INDEX)) return map;
  const lines = fs.readFileSync(config.CODEX_SESSION_INDEX, "utf8").split("\n").filter((l) => l.trim());
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

/**
 * Load all Codex session metadata (merged from DB + index).
 */
function loadCodexSessionMeta(mergeSessionMetaRecordsCore, indexed = loadCodexSessionIndexMeta(mergeSessionMetaRecordsCore)) {
  const merged = loadThreadMetadataMap();
  for (const [id, meta] of indexed) {
    merged.set(id, mergeSessionMetaRecordsCore(merged.get(id), meta));
  }
  return merged;
}

function shouldApplySessionTitleOverride(authoritative, override) {
  const authoritativeTitle = String(authoritative?.title || "").trim();
  if (!authoritativeTitle) return true;
  if (authoritativeTitle === String(override?.title || "").trim()) return false;
  const authoritativeUpdatedAt = Number(authoritative?.updatedAtMs) || 0;
  const overrideUpdatedAt = Number(override?.updatedAtMs) || 0;
  return overrideUpdatedAt > authoritativeUpdatedAt;
}

/**
 * Load all merged thread metadata (Codex + Claude Code).
 */
function loadMergedThreadMetadata(mergeSessionMetaRecordsCore) {
  const codexIndexMeta = loadCodexSessionIndexMeta(mergeSessionMetaRecordsCore);
  const threadMeta = loadCodexSessionMeta(mergeSessionMetaRecordsCore, codexIndexMeta);
  const claudeMeta = loadClaudeCodeSessionMeta();
  const authoritativeTitles = new Map(codexIndexMeta);
  for (const [id, meta] of claudeMeta) {
    threadMeta.set(id, mergeSessionMetaRecordsCore(threadMeta.get(id), meta));
    authoritativeTitles.set(id, meta);
  }
  for (const [id, meta] of loadSessionTitleOverrides()) {
    if (!shouldApplySessionTitleOverride(authoritativeTitles.get(id), meta)) continue;
    threadMeta.set(id, mergeSessionMetaRecordsCore(threadMeta.get(id), meta));
  }
  return threadMeta;
}

/**
 * Load Claude Code session name map (sessionId -> title).
 */
function loadClaudeSessionIndex() {
  const map = new Map();
  if (!fs.existsSync(config.CLAUDE_SESSIONS_DIR)) return map;
  const files = fs.readdirSync(config.CLAUDE_SESSIONS_DIR).filter((file) => file.endsWith(".json"));
  for (const file of files) {
    try {
      const data = JSON.parse(fs.readFileSync(path.join(config.CLAUDE_SESSIONS_DIR, file), "utf8"));
      if (data.sessionId && typeof data.name === "string" && data.name.trim()) {
        map.set(data.sessionId, data.name.trim());
      }
    } catch {
      // skip
    }
  }
  return map;
}

/**
 * Find a Claude Code session JSON file by session ID.
 */
function findClaudeSessionFile(sessionId) {
  if (!fs.existsSync(config.CLAUDE_SESSIONS_DIR)) return null;
  const files = fs.readdirSync(config.CLAUDE_SESSIONS_DIR).filter((f) => f.endsWith(".json"));
  for (const file of files) {
    try {
      const data = JSON.parse(fs.readFileSync(path.join(config.CLAUDE_SESSIONS_DIR, file), "utf8"));
      if (data.sessionId === sessionId) return path.join(config.CLAUDE_SESSIONS_DIR, file);
    } catch {
      // skip
    }
  }
  return null;
}

/**
 * Find Claude Code transcript JSONL files matching a session ID.
 */
function findClaudeTranscriptFiles(sessionId) {
  const files = [];
  if (!fs.existsSync(config.CLAUDE_PROJECTS_DIR)) return files;
  const projects = fs.readdirSync(config.CLAUDE_PROJECTS_DIR);
  for (const project of projects) {
    const projectDir = path.join(config.CLAUDE_PROJECTS_DIR, project);
    if (!fs.statSync(projectDir).isDirectory()) continue;
    try {
      const entries = fs.readdirSync(projectDir, { withFileTypes: true });
      for (const e of entries) {
        if (e.isFile() && e.name.startsWith(sessionId) && e.name.endsWith(".jsonl")) {
          files.push(path.join(projectDir, e.name));
        } else if (e.isDirectory()) {
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

/**
 * Find Codex session JSONL files matching a session ID.
 */
function findCodexSessionFiles(sessionId) {
  if (!fs.existsSync(config.SESSIONS_DIR)) return [];
  const files = [];
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
  searchDir(config.SESSIONS_DIR);
  return files;
}

module.exports = {
  loadThreadMetadataMap,
  loadClaudeCodeSessionMeta,
  loadCodexSessionIndexMeta,
  loadCodexSessionMeta,
  loadMergedThreadMetadata,
  shouldApplySessionTitleOverride,
  loadClaudeSessionIndex,
  loadSessionTitleOverrides,
  markSessionTitleOverride,
  removeSessionTitleOverride,
  findClaudeSessionFile,
  findClaudeTranscriptFiles,
  findCodexSessionFiles,
};
