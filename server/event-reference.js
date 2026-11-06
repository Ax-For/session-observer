const crypto = require("crypto");

function fileKey(file) {
  return crypto.createHash("sha256").update(file).digest("hex").slice(0, 24);
}

function encodeReference(file, offset, index = 0, length = 0, context = {}) {
  const identity = Buffer.from(JSON.stringify({ sessionId: context.sessionId || "", time: context.time || "" })).toString("base64url");
  return `v3:${fileKey(file)}:${offset}:${index}:${length}:${identity}`;
}

function decodeReference(id, records) {
  const current = /^v3:([a-f0-9]{24}):(\d+):(\d+):(\d+):([A-Za-z0-9_-]{1,700})$/.exec(String(id || ""));
  const match = current || /^v2:([a-f0-9]{24}):(\d+):(\d+):(\d+):(\d+)$/.exec(String(id || ""));
  if (!match) return null;
  const [, key, offset, index, length] = match;
  const line = current ? 0 : match[5];
  let context = {};
  if (current) {
    try { context = JSON.parse(Buffer.from(match[5], "base64url").toString()); }
    catch { return null; }
    if (typeof context.sessionId !== "string" || typeof context.time !== "string") return null;
  }
  if (![offset, index, length, line].every((value) => Number.isSafeInteger(Number(value)))) return null;
  const record = records.find((entry) => fileKey(typeof entry === "string" ? entry : entry.file) === key);
  if (!record) return null;
  return {
    sessionId: context.sessionId,
    expectedTime: context.time,
    sourceFile: typeof record === "string" ? record : record.file,
    sourceOffset: Number(offset), lineEventIndex: Number(index), sourceLength: Number(length), sourceLine: Number(line),
  };
}

function compareEvents(a, b, order = "desc") {
  const time = (Date.parse(a.time) || 0) - (Date.parse(b.time) || 0);
  const tie = String(a.eventId || a.id || "").localeCompare(String(b.eventId || b.id || ""));
  return (order === "asc" ? 1 : -1) * (time || tie);
}

function encodeCursor(event, order) {
  return Buffer.from(JSON.stringify({ time: event.time || "", eventId: event.eventId, order })).toString("base64url");
}

function decodeCursor(value, order) {
  if (!value) return null;
  try {
    if (value.length > 2048) throw new Error();
    const data = JSON.parse(Buffer.from(value, "base64url").toString());
    if (data.order !== order || typeof data.time !== "string" || typeof data.eventId !== "string") throw new Error();
    return data;
  } catch {
    throw new Error("Invalid event cursor; reload this view");
  }
}

module.exports = { fileKey, encodeReference, decodeReference, compareEvents, encodeCursor, decodeCursor };
