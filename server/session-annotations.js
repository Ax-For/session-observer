const fs = require("fs");
const path = require("path");

const ALLOWED_OUTCOMES = new Set(["unreviewed", "success", "partial", "failed"]);

function normalizeText(value, limit) {
  return String(value || "").trim().slice(0, limit);
}

function normalizeAnnotation(sessionId, value = {}) {
  const outcome = ALLOWED_OUTCOMES.has(value.outcome) ? value.outcome : "unreviewed";
  const tags = [...new Set((Array.isArray(value.tags) ? value.tags : [])
    .map((tag) => normalizeText(tag, 32))
    .filter(Boolean))]
    .slice(0, 12);
  return {
    sessionId: String(sessionId || "").trim(),
    outcome,
    favorite: Boolean(value.favorite),
    tags,
    note: normalizeText(value.note, 2000),
    updatedAt: new Date().toISOString(),
  };
}

function createSessionAnnotationStore(options = {}) {
  const file = options.file;
  let loaded = false;
  let annotations = new Map();

  function load() {
    if (loaded) return;
    loaded = true;
    if (!file) return;
    try {
      const payload = JSON.parse(fs.readFileSync(file, "utf8"));
      annotations = new Map(Object.entries(payload?.annotations || {}));
    } catch {
      annotations = new Map();
    }
  }

  function persist() {
    if (!file) return;
    fs.mkdirSync(path.dirname(file), { recursive: true });
    const temporary = `${file}.${process.pid}.tmp`;
    fs.writeFileSync(temporary, JSON.stringify({
      version: 1,
      updatedAt: new Date().toISOString(),
      annotations: Object.fromEntries(annotations),
    }, null, 2));
    fs.renameSync(temporary, file);
  }

  function get(sessionId) {
    load();
    const key = String(sessionId || "").trim();
    return key && annotations.has(key) ? { ...annotations.get(key) } : null;
  }

  function list(sessionIds = null) {
    load();
    const allowed = Array.isArray(sessionIds) && sessionIds.length ? new Set(sessionIds) : null;
    return [...annotations.values()]
      .filter((annotation) => !allowed || allowed.has(annotation.sessionId))
      .map((annotation) => ({ ...annotation }))
      .sort((left, right) => String(right.updatedAt).localeCompare(String(left.updatedAt)));
  }

  function set(sessionId, value) {
    load();
    const normalized = normalizeAnnotation(sessionId, value);
    if (!normalized.sessionId) throw new Error("sessionId required");
    annotations.set(normalized.sessionId, normalized);
    persist();
    return { ...normalized };
  }

  return { get, list, set };
}

module.exports = {
  createSessionAnnotationStore,
  normalizeAnnotation,
};
