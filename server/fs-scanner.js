#!/usr/bin/env node
/**
 * File scanning, JSONL line reading, and streaming utilities.
 * Handles recursive directory walking and incremental file event caching.
 */
const fs = require("fs");
const path = require("path");
const config = require("./config");
const { resolveSourceAdapterForFile } = require("../shared/source-adapters");

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
 * Read a JSONL record by byte offset. Reverse event scans use this to avoid a
 * full line-count pass on very large active transcript files.
 */
function readJsonlLineAtOffset(file, offset, maxBytes = 0) {
  const startOffset = Number(offset);
  if (!fs.existsSync(file) || !Number.isFinite(startOffset) || startOffset < 0) return "";
  const byteLimit = Math.max(0, Number(maxBytes) || 0);
  const fd = fs.openSync(file, "r");
  const buffer = Buffer.alloc(64 * 1024);
  const parts = [];
  let position = startOffset;

  try {
    while (true) {
      const bytesRead = fs.readSync(fd, buffer, 0, buffer.length, position);
      if (bytesRead <= 0) break;

      let segmentEnd = bytesRead;
      for (let index = 0; index < bytesRead; index += 1) {
        if (buffer[index] === 10) {
          segmentEnd = index;
          break;
        }
      }

      const collectedBytes = position - startOffset + segmentEnd;
      if (byteLimit > 0 && collectedBytes > byteLimit) return "";
      if (segmentEnd > 0) parts.push(Buffer.from(buffer.subarray(0, segmentEnd)));
      if (segmentEnd < bytesRead) break;
      position += bytesRead;
    }
  } finally {
    fs.closeSync(fd);
  }

  return parts.length ? Buffer.concat(parts).toString("utf8").replace(/\r$/, "") : "";
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
 * Iterate only complete JSONL lines. A trailing partial line is returned instead
 * of parsed, which avoids dropping data while a log file is still being written.
 */
function forEachCompleteJsonlLine(file, onLine, options = {}) {
  const startOffset = Math.max(0, Number(options.startOffset) || 0);
  const initialLineNumber = Math.max(0, Number(options.initialLineNumber) || 0);
  const initialTailBuffer = String(options.initialTailBuffer || "");
  const result = {
    lineCount: initialLineNumber,
    tailBuffer: "",
    endedWithNewline: options.initialEndedWithNewline === true,
  };
  if (!fs.existsSync(file)) return result;
  const fd = fs.openSync(file, "r");
  const buffer = Buffer.alloc(64 * 1024);
  let parts = [];
  let partsLength = 0;
  let truncatedBytes = 0;
  let lineNumber = initialLineNumber + 1;
  let byteOffset = startOffset;
  let lineByteOffset = Number.isFinite(Number(options.initialLineByteOffset))
    ? Math.max(0, Number(options.initialLineByteOffset))
    : startOffset;
  const maxLineBytes = Number(options.maxLineBytes) || 0;

  const pushSegment = (segment) => {
    if (!segment.length) return;
    if (maxLineBytes > 0 && partsLength + segment.length > maxLineBytes) {
      const remaining = Math.max(0, maxLineBytes - partsLength);
      if (remaining > 0) {
        parts.push(Buffer.from(segment.subarray(0, remaining)));
        partsLength += remaining;
      }
      truncatedBytes += segment.length - remaining;
      return;
    }
    parts.push(Buffer.from(segment));
    partsLength += segment.length;
  };

  const emitLine = () => {
    const line = parts.length ? Buffer.concat(parts).toString("utf8").replace(/\r$/, "") : "";
    const byteLength = partsLength + truncatedBytes;
    const keepGoing = onLine(line, lineNumber, {
      byteOffset: lineByteOffset,
      byteLength,
      truncated: truncatedBytes > 0,
    });
    result.lineCount = lineNumber;
    result.endedWithNewline = true;
    parts = [];
    partsLength = 0;
    truncatedBytes = 0;
    lineNumber += 1;
    return keepGoing;
  };

  if (initialTailBuffer) {
    pushSegment(Buffer.from(initialTailBuffer));
    result.endedWithNewline = false;
  }

  try {
    while (true) {
      const bytesRead = fs.readSync(fd, buffer, 0, buffer.length, byteOffset);
      if (bytesRead <= 0) break;

      let segmentStart = 0;
      for (let index = 0; index < bytesRead; index += 1) {
        if (buffer[index] !== 10) continue;

        pushSegment(buffer.subarray(segmentStart, index));
        const keepGoing = emitLine();
        segmentStart = index + 1;
        lineByteOffset = byteOffset + segmentStart;
        if (keepGoing === false) return result;
      }

      if (segmentStart < bytesRead) {
        pushSegment(buffer.subarray(segmentStart, bytesRead));
        result.endedWithNewline = false;
      }
      byteOffset += bytesRead;
    }

    if (parts.length) {
      result.tailBuffer = Buffer.concat(parts).toString("utf8").replace(/\r$/, "");
    }
  } finally {
    fs.closeSync(fd);
  }

  return result;
}

function countCompleteJsonlLines(file) {
  if (!fs.existsSync(file)) return { lineCount: 0, endedWithNewline: false };
  const fd = fs.openSync(file, "r");
  const buffer = Buffer.alloc(64 * 1024);
  let lineCount = 0;
  let endedWithNewline = false;

  try {
    while (true) {
      const bytesRead = fs.readSync(fd, buffer, 0, buffer.length, null);
      if (bytesRead <= 0) break;
      for (let index = 0; index < bytesRead; index += 1) {
        if (buffer[index] === 10) lineCount += 1;
      }
      endedWithNewline = buffer[bytesRead - 1] === 10;
    }
  } finally {
    fs.closeSync(fd);
  }

  return { lineCount, endedWithNewline };
}

function fileEndsWithNewline(file) {
  if (!fs.existsSync(file)) return false;
  const stat = fs.statSync(file);
  if (stat.size <= 0) return false;
  const fd = fs.openSync(file, "r");
  const buffer = Buffer.alloc(1);
  try {
    fs.readSync(fd, buffer, 0, 1, stat.size - 1);
    return buffer[0] === 10;
  } finally {
    fs.closeSync(fd);
  }
}

/**
 * Iterate complete JSONL lines from the end of a file. A trailing partial line
 * is skipped, matching forEachCompleteJsonlLine's behavior for active files.
 */
function forEachCompleteJsonlLineReverse(file, onLine, options = {}) {
  const shouldCountLines = options.countLines !== false;
  const maxLineBytes = Number(options.maxLineBytes) || 0;
  const count = shouldCountLines
    ? countCompleteJsonlLines(file)
    : { lineCount: null, endedWithNewline: fileEndsWithNewline(file) };
  const result = {
    lineCount: count.lineCount,
    endedWithNewline: count.endedWithNewline,
    stoppedEarly: false,
  };
  if (!fs.existsSync(file) || (shouldCountLines && count.lineCount <= 0)) return result;

  const fd = fs.openSync(file, "r");
  const bufferSize = 64 * 1024;
  const buffer = Buffer.alloc(bufferSize);
  let position = fs.statSync(file).size;
  let tail = Buffer.alloc(0);
  let lineNumber = count.lineCount;
  let skippedTrailingPartial = count.endedWithNewline;
  let truncatedBytes = 0;

  try {
    while (position > 0) {
      const bytesToRead = Math.min(bufferSize, position);
      position -= bytesToRead;
      const bytesRead = fs.readSync(fd, buffer, 0, bytesToRead, position);
      if (bytesRead <= 0) break;

      const chunk = Buffer.from(buffer.subarray(0, bytesRead));
      const combined = tail.length ? Buffer.concat([chunk, tail]) : chunk;
      let segmentEnd = combined.length;

      for (let index = combined.length - 1; index >= 0; index -= 1) {
        if (combined[index] !== 10) continue;
        const segment = combined.subarray(index + 1, segmentEnd);
        segmentEnd = index;

        if (!segment.length) {
          skippedTrailingPartial = true;
          continue;
        }

        if (!skippedTrailingPartial) {
          skippedTrailingPartial = true;
          truncatedBytes = 0;
          continue;
        }

        const keepGoing = onLine(segment.toString("utf8").replace(/\r$/, ""), lineNumber, {
          byteOffset: position + index + 1,
          byteLength: segment.length + truncatedBytes,
          truncated: truncatedBytes > 0,
        });
        truncatedBytes = 0;
        if (lineNumber != null) lineNumber -= 1;
        if (keepGoing === false) {
          result.stoppedEarly = true;
          return result;
        }
      }

      tail = Buffer.from(combined.subarray(0, segmentEnd));
      if (maxLineBytes > 0 && tail.length > maxLineBytes) {
        truncatedBytes += tail.length;
        tail = Buffer.alloc(0);
      }
    }

    if (tail.length && (lineNumber == null || lineNumber > 0)) {
      const keepGoing = onLine(tail.toString("utf8").replace(/\r$/, ""), lineNumber, {
        byteOffset: 0,
        byteLength: tail.length + truncatedBytes,
        truncated: truncatedBytes > 0,
      });
      if (keepGoing === false) result.stoppedEarly = true;
    }
  } finally {
    fs.closeSync(fd);
  }

  return result;
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
  const adapter = resolveSourceAdapterForFile(filePath);
  const parser = parsers[adapter.parserKey] || parsers.parseCodexLineToEvent;
  const sessionsDir = adapter.key === "claude" ? config.CLAUDE_PROJECTS_DIR : config.SESSIONS_DIR;
  return { adapter, parser, sessionsDir };
}

module.exports = {
  listJsonlFiles,
  readJsonlLine,
  readJsonlLineAtOffset,
  forEachJsonlLine,
  forEachCompleteJsonlLine,
  forEachCompleteJsonlLineReverse,
  getPathSignature,
  resolveParserForFile,
};
