#!/usr/bin/env node
/**
 * Utilities for reducing large JSONL records before JSON.parse on list/summary
 * paths. Full detail and export paths still parse original lines.
 */

const DEFAULT_FIELDS = ["output", "arguments"];
const DEFAULT_THRESHOLD = 4096;
const DEFAULT_MAX_VALUE_LENGTH = 800;

function findJsonStringEnd(source, quoteIndex) {
  let escaped = false;
  for (let index = quoteIndex + 1; index < source.length; index += 1) {
    const char = source[index];
    if (escaped) {
      escaped = false;
      continue;
    }
    if (char === "\\") {
      escaped = true;
      continue;
    }
    if (char === "\"") return index;
  }
  return -1;
}

function skipWhitespace(source, index) {
  let cursor = index;
  while (cursor < source.length && /\s/.test(source[cursor])) cursor += 1;
  return cursor;
}

function findNextField(source, fields, fromIndex) {
  let bestIndex = -1;
  let bestField = "";
  for (const field of fields) {
    const index = source.indexOf(`"${field}"`, fromIndex);
    if (index === -1) continue;
    if (bestIndex === -1 || index < bestIndex) {
      bestIndex = index;
      bestField = field;
    }
  }
  return { index: bestIndex, field: bestField };
}

function compactLargeJsonlLine(line, options = {}) {
  const source = String(line || "");
  const threshold = Number(options.threshold) || DEFAULT_THRESHOLD;
  if (source.length <= threshold) return source;

  const fields = Array.isArray(options.fields) && options.fields.length ? options.fields : DEFAULT_FIELDS;
  const maxValueLength = Number(options.maxValueLength) || DEFAULT_MAX_VALUE_LENGTH;
  let searchFrom = 0;
  let lastEmit = 0;
  let changed = false;
  let output = "";

  while (searchFrom < source.length) {
    const next = findNextField(source, fields, searchFrom);
    if (next.index === -1) break;

    let cursor = next.index + next.field.length + 2;
    cursor = skipWhitespace(source, cursor);
    if (source[cursor] !== ":") {
      searchFrom = next.index + 1;
      continue;
    }
    cursor = skipWhitespace(source, cursor + 1);
    if (source[cursor] !== "\"") {
      searchFrom = cursor + 1;
      continue;
    }

    const valueEnd = findJsonStringEnd(source, cursor);
    if (valueEnd === -1) break;
    const rawValueLength = valueEnd - cursor - 1;

    if (rawValueLength > maxValueLength) {
      const placeholder = `[${next.field} omitted for summary: ${rawValueLength} chars]`;
      output += source.slice(lastEmit, cursor + 1);
      output += placeholder;
      output += "\"";
      lastEmit = valueEnd + 1;
      changed = true;
    }

    searchFrom = valueEnd + 1;
  }

  return changed ? output + source.slice(lastEmit) : source;
}

module.exports = {
  compactLargeJsonlLine,
};
