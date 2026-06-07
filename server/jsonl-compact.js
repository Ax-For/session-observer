#!/usr/bin/env node
/**
 * Utilities for reducing large JSONL records before JSON.parse on list/summary
 * paths. Full detail and export paths still parse original lines.
 */

const DEFAULT_FIELDS = [
  "output",
  "arguments",
  "text",
  "input_text",
  "output_text",
  "message",
  "content",
  "thinking",
  "encrypted_content",
];
const DEFAULT_VALUE_FIELDS = ["replacement_history"];
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

function findJsonContainerEnd(source, startIndex) {
  const opener = source[startIndex];
  const closer = opener === "{" ? "}" : opener === "[" ? "]" : "";
  if (!closer) return -1;

  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let index = startIndex; index < source.length; index += 1) {
    const char = source[index];
    if (inString) {
      if (escaped) {
        escaped = false;
      } else if (char === "\\") {
        escaped = true;
      } else if (char === "\"") {
        inString = false;
      }
      continue;
    }

    if (char === "\"") {
      inString = true;
      continue;
    }
    if (char === opener) depth += 1;
    if (char === closer) {
      depth -= 1;
      if (depth === 0) return index;
    }
  }
  return -1;
}

function findJsonPrimitiveEnd(source, startIndex) {
  for (let index = startIndex; index < source.length; index += 1) {
    const char = source[index];
    if (char === "," || char === "}" || char === "]") return index - 1;
  }
  return source.length - 1;
}

function findJsonValueEnd(source, startIndex) {
  const char = source[startIndex];
  if (char === "\"") return findJsonStringEnd(source, startIndex);
  if (char === "{" || char === "[") return findJsonContainerEnd(source, startIndex);
  return findJsonPrimitiveEnd(source, startIndex);
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
  const valueFields = Array.isArray(options.valueFields) && options.valueFields.length
    ? options.valueFields
    : DEFAULT_VALUE_FIELDS;
  const allFields = [...new Set([...fields, ...valueFields])];
  const valueFieldSet = new Set(valueFields);
  const maxValueLength = Number(options.maxValueLength) || DEFAULT_MAX_VALUE_LENGTH;
  let searchFrom = 0;
  let lastEmit = 0;
  let changed = false;
  let output = "";

  while (searchFrom < source.length) {
    const next = findNextField(source, allFields, searchFrom);
    if (next.index === -1) break;

    let cursor = next.index + next.field.length + 2;
    cursor = skipWhitespace(source, cursor);
    if (source[cursor] !== ":") {
      searchFrom = next.index + 1;
      continue;
    }
    cursor = skipWhitespace(source, cursor + 1);
    const allowAnyValue = valueFieldSet.has(next.field);
    if (!allowAnyValue && source[cursor] !== "\"") {
      searchFrom = cursor + 1;
      continue;
    }

    const valueEnd = allowAnyValue ? findJsonValueEnd(source, cursor) : findJsonStringEnd(source, cursor);
    if (valueEnd === -1) break;
    const isStringValue = source[cursor] === "\"";
    const rawValueLength = isStringValue ? valueEnd - cursor - 1 : valueEnd - cursor + 1;

    if (rawValueLength > maxValueLength) {
      const placeholder = `[${next.field} omitted for summary: ${rawValueLength} chars]`;
      output += source.slice(lastEmit, isStringValue ? cursor + 1 : cursor);
      if (!isStringValue) output += "\"";
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
