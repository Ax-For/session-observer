#!/usr/bin/env node
/**
 * Session export and sanitization helpers.
 */
const os = require("os");
const { buildTraceModel, summarizeTraceModel } = require("../shared/trace-model");

const SECRET_PATTERNS = [
  /\bsk-[A-Za-z0-9_-]{16,}\b/g,
  /\bsk-proj-[A-Za-z0-9_-]{16,}\b/g,
  /\bgh[pousr]_[A-Za-z0-9_]{16,}\b/g,
  /\b(xox[baprs]-[A-Za-z0-9-]{16,})\b/g,
  /\b(Bearer\s+)[A-Za-z0-9._-]{20,}\b/gi,
  /\b([A-Z0-9_]*(?:API_KEY|TOKEN|SECRET|PASSWORD)[A-Z0-9_]*\s*=\s*)[^\s"']+/gi,
];

function sanitizeText(value, options = {}) {
  let text = String(value ?? "");
  for (const pattern of SECRET_PATTERNS) {
    text = text.replace(pattern, (match, prefix) => (
      prefix && /=$|\s+$/.test(prefix) ? `${prefix}[REDACTED_SECRET]` : "[REDACTED_SECRET]"
    ));
  }

  const homeDir = String(options.homeDir || os.homedir() || "");
  if (homeDir) {
    text = text.replaceAll(homeDir, "~");
  }
  return text;
}

function sanitizeValue(value, options = {}) {
  if (typeof value === "string") return sanitizeText(value, options);
  if (Array.isArray(value)) return value.map((item) => sanitizeValue(item, options));
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value).map(([key, item]) => [key, sanitizeValue(item, options)]),
    );
  }
  return value;
}

function sanitizeEventForExport(event, options = {}) {
  const sanitized = sanitizeValue(event || {}, options);
  delete sanitized.raw;
  return sanitized;
}

function eventTitle(event) {
  const pieces = [event.time, event.callType, event.model, event.toolName].filter(Boolean);
  return pieces.join(" · ");
}

function eventsToMarkdown(events, summary) {
  const first = events[0] || {};
  const lines = [
    `# Session ${first.sessionId || "unknown"}`,
    "",
    `- Source: ${first.sourceType || "unknown"}`,
    `- Workspace: ${first.cwd || "unknown"}`,
    `- Events: ${events.length}`,
    `- Trace spans: ${summary.spans}`,
    `- Tool spans: ${summary.toolSpans}`,
    `- Token spans: ${summary.tokenSpans}`,
    "",
  ];

  for (const event of events) {
    lines.push(`## ${eventTitle(event) || "Event"}`);
    lines.push("");
    if (event.summary && event.summary !== event.content) {
      lines.push(event.summary);
      lines.push("");
    }
    if (event.content) {
      lines.push("```text");
      lines.push(String(event.content));
      lines.push("```");
      lines.push("");
    }
    if (event.tokenUsage) {
      lines.push("```json");
      lines.push(JSON.stringify(event.tokenUsage, null, 2));
      lines.push("```");
      lines.push("");
    }
  }

  return `${lines.join("\n").trim()}\n`;
}

function createSessionExport(events, options = {}) {
  const format = options.format === "markdown" || options.format === "md" ? "markdown" : "jsonl";
  const sanitize = options.sanitize !== false;
  const exportEvents = sanitize
    ? (events || []).map((event) => sanitizeEventForExport(event, options))
    : (events || []).map((event) => ({ ...event }));
  const sessionId = exportEvents[0]?.sessionId || options.sessionId || "session";
  const traceSummary = summarizeTraceModel(buildTraceModel(exportEvents));
  const suffix = sanitize ? "sanitized" : "raw";

  if (format === "markdown") {
    return {
      body: eventsToMarkdown(exportEvents, traceSummary),
      contentType: "text/markdown; charset=utf-8",
      filename: `${sessionId}-${suffix}.md`,
      traceSummary,
    };
  }

  return {
    body: `${exportEvents.map((event) => JSON.stringify(event)).join("\n")}\n`,
    contentType: "application/x-ndjson; charset=utf-8",
    filename: `${sessionId}-${suffix}.jsonl`,
    traceSummary,
  };
}

module.exports = {
  createSessionExport,
  sanitizeEventForExport,
  sanitizeText,
};
