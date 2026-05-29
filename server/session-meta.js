#!/usr/bin/env node
/**
 * Session metadata loading from Codex (SQLite DB + index) and Claude Code (session JSON).
 */
const fs = require("fs");
const path = require("path");
const { spawnSync } = require("child_process");
const config = require("./config");

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
function loadCodexSessionMeta(mergeSessionMetaRecordsCore) {
  const merged = loadThreadMetadataMap();
  const indexed = loadCodexSessionIndexMeta(mergeSessionMetaRecordsCore);
  for (const [id, meta] of indexed) {
    merged.set(id, mergeSessionMetaRecordsCore(merged.get(id), meta));
  }
  return merged;
}

/**
 * Load all merged thread metadata (Codex + Claude Code).
 */
function loadMergedThreadMetadata(mergeSessionMetaRecordsCore) {
  const threadMeta = loadCodexSessionMeta(mergeSessionMetaRecordsCore);
  const claudeMeta = loadClaudeCodeSessionMeta();
  for (const [id, meta] of claudeMeta) {
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
  loadClaudeSessionIndex,
  findClaudeSessionFile,
  findClaudeTranscriptFiles,
  findCodexSessionFiles,
};
