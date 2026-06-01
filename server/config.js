#!/usr/bin/env node
/**
 * Environment configuration and constants for the Session Observer server.
 */
const path = require("path");
const os = require("os");

const HOST = process.env.HOST || "127.0.0.1";
const PORT = process.env.PORT ? Number(process.env.PORT) : 8787;
// server/config.js is one level below project root
const ROOT = path.resolve(__dirname, "..");
const DIST_ROOT = path.join(ROOT, "dist");
const DIST_INDEX = path.join(DIST_ROOT, "index.html");

const SESSIONS_DIR = process.env.CODEX_SESSIONS_DIR || path.join(os.homedir(), ".codex", "sessions");
const CLAUDE_PROJECTS_DIR = process.env.CLAUDE_PROJECTS_DIR || path.join(os.homedir(), ".claude", "projects");
const CLAUDE_SESSIONS_DIR = path.join(os.homedir(), ".claude", "sessions");
const CODEX_SESSION_INDEX = path.join(os.homedir(), ".codex", "session_index.jsonl");
const STATE_DB = process.env.CODEX_STATE_DB || path.join(os.homedir(), ".codex", "state_5.sqlite");

const DEFAULT_PAGE_SIZE = 250;
const MAX_PAGE_SIZE = 1000;
const EVENT_CONTENT_PREVIEW_LENGTH = 280;
const EVENT_SEARCH_TEXT_LENGTH = EVENT_CONTENT_PREVIEW_LENGTH;
const INDEX_REFRESH_DEBOUNCE_MS = 400;
const INDEX_WARMUP_INTERVAL_MS = 3000;

function toNonNegativeInt(value, fallback) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 0) return fallback;
  return Math.floor(parsed);
}

const INDEX_FILE_EVENT_CACHE_MAX_EVENTS = toNonNegativeInt(
  process.env.INDEX_FILE_EVENT_CACHE_MAX_EVENTS,
  0,
);

/**
 * Resolve the static file root, triggering a frontend build if needed.
 */
function resolveStaticRoot() {
  const fs = require("fs");
  if (!fs.existsSync(path.join(ROOT, "package.json"))) return ROOT;
  if (fs.existsSync(DIST_INDEX)) return DIST_ROOT;

  console.log("[frontend] dist not found, running npm build...");
  const { spawnSync } = require("child_process");
  const proc = spawnSync("npm", ["run", "build"], {
    cwd: ROOT,
    stdio: "inherit",
    env: process.env,
  });

  if (proc.status !== 0 || !fs.existsSync(DIST_INDEX)) {
    throw new Error("Frontend build failed; dist/index.html is missing.");
  }
  return DIST_ROOT;
}

const STATIC_ROOT = resolveStaticRoot();

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
};

module.exports = {
  HOST,
  PORT,
  ROOT,
  STATIC_ROOT,
  DIST_ROOT,
  DIST_INDEX,
  SESSIONS_DIR,
  CLAUDE_PROJECTS_DIR,
  CLAUDE_SESSIONS_DIR,
  CODEX_SESSION_INDEX,
  STATE_DB,
  DEFAULT_PAGE_SIZE,
  MAX_PAGE_SIZE,
  EVENT_CONTENT_PREVIEW_LENGTH,
  EVENT_SEARCH_TEXT_LENGTH,
  INDEX_REFRESH_DEBOUNCE_MS,
  INDEX_WARMUP_INTERVAL_MS,
  INDEX_FILE_EVENT_CACHE_MAX_EVENTS,
  MIME,
};
