#!/usr/bin/env node
/**
 * Session management operations: rename, delete, observability.
 */
const fs = require("fs");
const path = require("path");
const { spawnSync } = require("child_process");
const config = require("./config");
const sessionMeta = require("./session-meta");

/**
 * Update Codex session index with a new thread name.
 */
function updateCodexSessionIndex(sessionId, newName) {
  if (!fs.existsSync(config.CODEX_SESSION_INDEX)) {
    const entry = JSON.stringify({
      id: sessionId,
      thread_name: newName,
      updated_at: new Date().toISOString(),
    });
    fs.writeFileSync(config.CODEX_SESSION_INDEX, entry + "\n", "utf8");
    return true;
  }
  const lines = fs.readFileSync(config.CODEX_SESSION_INDEX, "utf8").split("\n").filter((l) => l.trim());
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
  if (!found) {
    updated.push(JSON.stringify({
      id: sessionId,
      thread_name: newName,
      updated_at: new Date().toISOString(),
    }));
  }
  fs.writeFileSync(config.CODEX_SESSION_INDEX, updated.join("\n") + "\n", "utf8");
  return true;
}

/**
 * Escape a value for a SQLite string literal.
 */
function escapeSqliteString(value) {
  return `'${String(value || "").replace(/'/g, "''")}'`;
}

/**
 * Update Codex thread title in the state SQLite database.
 */
function updateCodexThreadTitle(sessionId, newName) {
  if (!fs.existsSync(config.STATE_DB)) return false;
  const nowMs = Date.now();
  const nowSec = Math.floor(nowMs / 1000);
  const sql = [
    `update threads set title = ${escapeSqliteString(newName)}, updated_at = ${nowSec}, updated_at_ms = ${nowMs}`,
    `where id = ${escapeSqliteString(sessionId)};`,
    "select changes();",
  ].join(" ");
  const proc = spawnSync("sqlite3", [config.STATE_DB, sql], { encoding: "utf8" });
  if (proc.status !== 0) return false;
  const changes = Number.parseInt((proc.stdout || "").trim().split(/\r?\n/).pop() || "0", 10);
  return Number.isFinite(changes) && changes > 0;
}

/**
 * Remove a Codex session from the index file.
 */
function removeCodexSessionFromIndex(sessionId) {
  if (!fs.existsSync(config.CODEX_SESSION_INDEX)) return;
  const lines = fs.readFileSync(config.CODEX_SESSION_INDEX, "utf8").split("\n").filter((l) => l.trim());
  const updated = lines.filter((line) => {
    try {
      const obj = JSON.parse(line);
      return obj.id !== sessionId;
    } catch {
      return true;
    }
  });
  fs.writeFileSync(config.CODEX_SESSION_INDEX, updated.join("\n") + (updated.length > 0 ? "\n" : ""), "utf8");
}

/**
 * Delete all Claude Code session-related files.
 */
function deleteClaudeSessionFiles(sessionId) {
  const home = require("os").homedir();
  const dirs = [
    { dir: path.join(home, ".claude", "session-env", sessionId), recursive: true },
    { dir: path.join(home, ".claude", "tasks", sessionId), recursive: true },
    { dir: path.join(home, ".claude", "file-history", sessionId), recursive: true },
    { dir: path.join(home, ".claude", "debug", `${sessionId}.txt`), recursive: false },
    { dir: path.join(home, ".claude", "shell-snapshots", `${sessionId}.sh`), recursive: false },
  ];

  if (fs.existsSync(config.CLAUDE_PROJECTS_DIR)) {
    const projects = fs.readdirSync(config.CLAUDE_PROJECTS_DIR);
    for (const project of projects) {
      const projectDir = path.join(config.CLAUDE_PROJECTS_DIR, project);
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

/**
 * Rename a session (tries Claude first, then Codex).
 */
function renameSession(sessionId, newName, scheduleIndexRefresh) {
  // Try Claude Code first
  const claudeFile = sessionMeta.findClaudeSessionFile(sessionId);
  if (claudeFile) {
    const data = JSON.parse(fs.readFileSync(claudeFile, "utf8"));
    data.name = newName;
    fs.writeFileSync(claudeFile, JSON.stringify(data), "utf8");
    sessionMeta.markSessionTitleOverride(sessionId, newName);
    scheduleIndexRefresh("session-renamed");
    return { success: true, sessionId, name: newName, platform: "claude" };
  }

  // Try Codex
  const codexDbUpdated = updateCodexThreadTitle(sessionId, newName);
  const codexIndexUpdated = updateCodexSessionIndex(sessionId, newName);
  if (codexDbUpdated || codexIndexUpdated) {
    sessionMeta.markSessionTitleOverride(sessionId, newName);
    scheduleIndexRefresh("session-renamed");
    return { success: true, sessionId, name: newName, platform: "codex" };
  }

  return { success: false, error: "Session not found" };
}

/**
 * Delete a single session (tries Claude first, then Codex).
 */
function deleteSession(sessionId, scheduleIndexRefresh) {
  // Try Claude Code deletion
  const claudeFile = sessionMeta.findClaudeSessionFile(sessionId);
  const claudeTranscripts = sessionMeta.findClaudeTranscriptFiles(sessionId);

  if (claudeFile || claudeTranscripts.length > 0) {
    if (claudeFile && fs.existsSync(claudeFile)) fs.unlinkSync(claudeFile);
    deleteClaudeSessionFiles(sessionId);
    sessionMeta.removeSessionTitleOverride(sessionId);
    scheduleIndexRefresh("session-deleted");
    return { success: true, sessionId, platform: "claude" };
  }

  // Try Codex deletion
  const codexFiles = sessionMeta.findCodexSessionFiles(sessionId);
  if (codexFiles.length > 0) {
    for (const f of codexFiles) {
      if (fs.existsSync(f)) fs.unlinkSync(f);
    }
    removeCodexSessionFromIndex(sessionId);
    sessionMeta.removeSessionTitleOverride(sessionId);
    scheduleIndexRefresh("session-deleted");
    return { success: true, sessionId, platform: "codex" };
  }

  return { success: false, error: "not found" };
}

/**
 * Batch delete sessions.
 */
function batchDeleteSessions(sessionIds, scheduleIndexRefresh) {
  const results = [];
  for (const sessionId of sessionIds) {
    try {
      results.push(deleteSession(sessionId, scheduleIndexRefresh));
    } catch (err) {
      results.push({ sessionId, success: false, error: String(err) });
    }
  }
  const deletedCount = results.filter((r) => r.success).length;
  return { success: true, total: sessionIds.length, deleted: deletedCount, results };
}

/**
 * Get directory status for observability.
 */
function directoryStatus(target) {
  const { listJsonlFiles } = require("./fs-scanner");
  try {
    if (!fs.existsSync(target)) {
      return { path: target, exists: false, files: 0, bytes: 0, updatedAt: "" };
    }
    const files = listJsonlFiles(target);
    let bytes = 0;
    let updatedAtMs = 0;
    for (const file of files) {
      try {
        const stat = fs.statSync(file);
        bytes += stat.size;
        if (stat.mtimeMs > updatedAtMs) updatedAtMs = stat.mtimeMs;
      } catch {
        // ignore files that disappear during a refresh
      }
    }
    return {
      path: target,
      exists: true,
      files: files.length,
      bytes,
      updatedAt: updatedAtMs ? new Date(updatedAtMs).toISOString() : "",
    };
  } catch (err) {
    return { path: target, exists: false, files: 0, bytes: 0, updatedAt: "", error: String(err) };
  }
}

module.exports = {
  renameSession,
  deleteSession,
  batchDeleteSessions,
  directoryStatus,
};
