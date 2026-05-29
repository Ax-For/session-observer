#!/usr/bin/env node
/**
 * File scanning, JSONL line reading, and streaming utilities.
 * Handles recursive directory walking and incremental file event caching.
 */
const fs = require("fs");
const path = require("path");
const config = require("./config");

/**
 * Recursively list all .jsonl files under a directory, skipping subagent dirs.
 */
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
        if (e.name === "subagents") continue;
        stack.push(full);
      } else if (e.isFile() && full.endsWith(".jsonl")) {
        out.push(full);
      }
    }
  }
  return out;
}

/**
 * Read a specific line from a JSONL file by line number.
 */
function readJsonlLine(file, targetLine) {
  if (!fs.existsSync(file) || !(targetLine > 0)) return "";
  const fd = fs.openSync(file, "r");
  const buffer = Buffer.alloc(64 * 1024);
  const parts = [];
  let currentLine = 1;
  let collecting = currentLine === targetLine;

  try {
    while (true) {
      const bytesRead = fs.readSync(fd, buffer, 0, buffer.length, null);
      if (bytesRead <= 0) break;

      let segmentStart = 0;
      for (let index = 0; index < bytesRead; index += 1) {
        if (buffer[index] !== 10) continue;

        if (collecting) {
          parts.push(Buffer.from(buffer.subarray(segmentStart, index)));
          return Buffer.concat(parts).toString("utf8").replace(/\r$/, "");
        }

        currentLine += 1;
        segmentStart = index + 1;
        collecting = currentLine === targetLine;
      }

      if (collecting && segmentStart < bytesRead) {
        parts.push(Buffer.from(buffer.subarray(segmentStart, bytesRead)));
      }
    }
  } finally {
    fs.closeSync(fd);
  }

  return collecting && parts.length ? Buffer.concat(parts).toString("utf8").replace(/\r$/, "") : "";
}

/**
 * Iterate over every line of a JSONL file, calling `onLine` per line.
 * Return `false` from `onLine` to stop early.
 */
function forEachJsonlLine(file, onLine) {
  if (!fs.existsSync(file)) return;
  const fd = fs.openSync(file, "r");
  const buffer = Buffer.alloc(64 * 1024);
  let parts = [];
  let lineNumber = 1;

  try {
    while (true) {
      const bytesRead = fs.readSync(fd, buffer, 0, buffer.length, null);
      if (bytesRead <= 0) break;

      let segmentStart = 0;
      for (let index = 0; index < bytesRead; index += 1) {
        if (buffer[index] !== 10) continue;

        parts.push(Buffer.from(buffer.subarray(segmentStart, index)));
        const keepGoing = onLine(
          Buffer.concat(parts).toString("utf8").replace(/\r$/, ""),
          lineNumber
        );
        parts = [];
        lineNumber += 1;
        segmentStart = index + 1;
        if (keepGoing === false) return;
      }

      if (segmentStart < bytesRead) {
        parts.push(Buffer.from(buffer.subarray(segmentStart, bytesRead)));
      }
    }

    if (parts.length) {
      onLine(Buffer.concat(parts).toString("utf8").replace(/\r$/, ""), lineNumber);
    }
  } finally {
    fs.closeSync(fd);
  }
}

/**
 * Get a stat-based signature for a file path to detect changes.
 */
function getPathSignature(target) {
  if (!fs.existsSync(target)) return "missing";
  const stat = fs.statSync(target);
  return `${stat.size}:${stat.mtimeMs}`;
}

/**
 * Check if a file path belongs to Codex or Claude Code, returning the appropriate parser.
 */
function resolveParserForFile(filePath, parsers) {
  if (filePath.includes("/.codex/")) return { parser: parsers.parseCodexLineToEvent, sessionsDir: config.SESSIONS_DIR };
  if (filePath.includes("/.claude/")) return { parser: parsers.parseClaudeCodeLineToEvent, sessionsDir: config.CLAUDE_PROJECTS_DIR };
  return { parser: parsers.parseCodexLineToEvent, sessionsDir: config.SESSIONS_DIR };
}

module.exports = {
  listJsonlFiles,
  readJsonlLine,
  forEachJsonlLine,
  getPathSignature,
  resolveParserForFile,
};
