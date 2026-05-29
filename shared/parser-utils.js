/**
 * Shared utility functions for JSONL event parsers.
 * CommonJS module — used by both codex-parsers.js and claude-parsers.js on the server.
 */

/**
 * Truncate text to a maximum length, appending "..." if truncated.
 */
function clip(text, max = 140) {
  const s = (text || "").trim().replace(/\s+/g, " ");
  return s.length <= max ? s : `${s.slice(0, max)}...`;
}

/**
 * Format a number with locale-specific grouping separators.
 */
function fmtNum(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return "-";
  return n.toLocaleString("zh-CN");
}

/**
 * Format a token count in human-readable shorthand (k, m).
 */
function fmtTokenHuman(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return "-";
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1).replace(/\.0$/, "")}m`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1).replace(/\.0$/, "")}k`;
  return String(n);
}

/**
 * Check if a token_usage object has any meaningful data.
 */
function hasTokenUsageData(tokenUsage) {
  if (!tokenUsage) return false;
  return ["input", "output", "total", "cachedInput", "reasoningOutput"].some((key) => {
    const value = tokenUsage[key];
    return value != null && Number.isFinite(Number(value));
  });
}

/**
 * Extract text content from a message content array.
 */
function parseContentFromMessage(content) {
  if (!Array.isArray(content)) return "";
  return content
    .map((item) => item?.text || item?.input_text || item?.output_text || "")
    .filter(Boolean)
    .join("\n");
}

/**
 * Summarize a raw JSON object into a short string for display.
 */
function summarizeRawObject(obj) {
  const payload = obj?.payload;
  if (typeof payload?.message === "string" && payload.message.trim()) return clip(payload.message, 220);
  if (typeof payload?.name === "string" && payload.name.trim()) return clip(payload.name, 220);
  if (typeof payload?.status === "string" && payload.status.trim()) return clip(payload.status, 220);
  if (typeof payload?.phase === "string" && payload.phase.trim()) return clip(payload.phase, 220);
  const raw = JSON.stringify(payload ?? obj);
  return clip(raw || "", 220);
}

/**
 * Extract text blocks from a content array (Claude assistant messages).
 */
function extractTextFromContent(content) {
  if (!Array.isArray(content)) return typeof content === "string" ? content : "";
  return content
    .filter((item) => item && typeof item === "object" && item.type === "text")
    .map((item) => item.text || "")
    .filter(Boolean)
    .join("\n");
}

/**
 * Extract thinking blocks from a content array.
 */
function extractThinkingFromContent(content) {
  if (!Array.isArray(content)) return "";
  return content
    .filter((item) => item && typeof item === "object" && item.type === "thinking")
    .map((item) => item.thinking || "")
    .filter(Boolean)
    .join("\n");
}

/**
 * Extract tool_use blocks from a content array.
 */
function extractToolCalls(content) {
  if (!Array.isArray(content)) return [];
  return content
    .filter((item) => item && typeof item === "object" && item.type === "tool_use")
    .map((item) => ({ name: item.name || "unknown", id: item.id || "", input: item.input }));
}

module.exports = {
  clip,
  fmtNum,
  fmtTokenHuman,
  hasTokenUsageData,
  parseContentFromMessage,
  summarizeRawObject,
  extractTextFromContent,
  extractThinkingFromContent,
  extractToolCalls,
};
