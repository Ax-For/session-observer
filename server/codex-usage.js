#!/usr/bin/env node
const { spawn } = require("child_process");
const { mkdir, readFile, rename, unlink, writeFile } = require("fs/promises");
const os = require("os");
const path = require("path");

const CODEX_USAGE_TIMEOUT_MS = 12_000;
const MAX_PROTOCOL_BUFFER_BYTES = 512 * 1024;
const CODEX_RESET_CREDITS_URL = "https://chatgpt.com/backend-api/wham/rate-limit-reset-credits";

function clampPercent(value) {
  const number = Number(value);
  if (!Number.isFinite(number)) return 0;
  return Math.max(0, Math.min(100, Math.round(number * 10) / 10));
}

function toResetIso(value) {
  const seconds = Number(value);
  if (!Number.isFinite(seconds) || seconds <= 0) return null;
  const date = new Date(seconds * 1000);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function toIsoDate(value) {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function normalizeResetCredits(result, fallbackCount) {
  const responseCount = Number(result?.available_count);
  const fallback = Number(fallbackCount);
  const availableCount = Number.isFinite(responseCount)
    ? Math.max(0, Math.trunc(responseCount))
    : Number.isFinite(fallback)
      ? Math.max(0, Math.trunc(fallback))
      : null;
  const upcoming = (Array.isArray(result?.credits) ? result.credits : [])
    .filter((credit) => credit?.status === "available")
    .map((credit) => ({
      title: String(credit?.title || "Usage reset").slice(0, 120),
      grantedAt: toIsoDate(credit?.granted_at),
      expiresAt: toIsoDate(credit?.expires_at),
    }))
    .filter((credit) => credit.expiresAt)
    .sort((left, right) => left.expiresAt.localeCompare(right.expiresAt))
    .slice(0, 3);

  if (availableCount == null && !upcoming.length) return null;
  return {
    availableCount: availableCount ?? upcoming.length,
    upcoming,
  };
}

function normalizeRateLimitWindow(window) {
  if (!window || typeof window !== "object") return null;
  const usedPercent = clampPercent(window.usedPercent);
  return {
    usedPercent,
    remainingPercent: clampPercent(100 - usedPercent),
    windowDurationMinutes: Number.isFinite(Number(window.windowDurationMins))
      ? Math.max(0, Number(window.windowDurationMins))
      : null,
    resetsAt: toResetIso(window.resetsAt),
  };
}

function normalizeRateLimit(limit, fallbackId = "codex") {
  if (!limit || typeof limit !== "object") return null;
  const id = String(limit.limitId || fallbackId || "codex");
  return {
    id,
    name: String(limit.limitName || (id === "codex" ? "Codex" : id)),
    primary: normalizeRateLimitWindow(limit.primary),
    secondary: normalizeRateLimitWindow(limit.secondary),
    credits: limit.credits && typeof limit.credits === "object"
      ? {
          hasCredits: Boolean(limit.credits.hasCredits),
          unlimited: Boolean(limit.credits.unlimited),
          balance: limit.credits.balance == null ? null : String(limit.credits.balance),
        }
      : null,
    rateLimitReachedType: limit.rateLimitReachedType
      ? String(limit.rateLimitReachedType)
      : null,
    planType: limit.planType ? String(limit.planType) : null,
  };
}

function normalizeCodexUsageResult(result, options = {}) {
  const updatedAt = options.updatedAt || new Date().toISOString();
  const defaultRateLimit = result?.rateLimits || null;
  const defaultLimitId = String(defaultRateLimit?.limitId || "codex");
  const byLimitId = result?.rateLimitsByLimitId && typeof result.rateLimitsByLimitId === "object"
    ? result.rateLimitsByLimitId
    : {};
  const sourceEntries = Object.keys(byLimitId).length
    ? Object.entries(byLimitId)
    : [[defaultLimitId, defaultRateLimit]];
  const limits = sourceEntries
    .map(([id, limit]) => normalizeRateLimit(limit, id))
    .filter(Boolean)
    .sort((left, right) => {
      if (left.id === defaultLimitId) return -1;
      if (right.id === defaultLimitId) return 1;
      return left.name.localeCompare(right.name);
    });
  const selectedLimit = limits.find((limit) => limit.id === defaultLimitId)
    || normalizeRateLimit(defaultRateLimit, defaultLimitId)
    || limits[0]
    || null;
  if (selectedLimit && !limits.some((limit) => limit.id === selectedLimit.id)) {
    limits.unshift(selectedLimit);
  }
  const availableCount = Number(result?.rateLimitResetCredits?.availableCount);
  const resetCredits = normalizeResetCredits(options.resetCreditsResult, availableCount);

  return {
    status: "ready",
    installed: true,
    version: String(options.version || "unknown"),
    updatedAt,
    planType: selectedLimit?.planType || null,
    defaultLimitId: selectedLimit?.id || defaultLimitId,
    resetCredits,
    limits,
    error: "",
  };
}

function normalizeCachedWindow(window) {
  if (!window || typeof window !== "object") return null;
  const usedPercent = clampPercent(window.usedPercent);
  const remainingPercent = clampPercent(window.remainingPercent ?? (100 - usedPercent));
  return {
    usedPercent,
    remainingPercent,
    windowDurationMinutes: Number.isFinite(Number(window.windowDurationMinutes))
      ? Math.max(0, Number(window.windowDurationMinutes))
      : null,
    resetsAt: toIsoDate(window.resetsAt),
  };
}

function normalizeCachedSnapshot(value, version = "unknown") {
  if (!value || value.status !== "ready") return null;
  const updatedAt = toIsoDate(value.updatedAt);
  if (!updatedAt) return null;
  const limits = (Array.isArray(value.limits) ? value.limits : [])
    .slice(0, 16)
    .map((limit) => {
      if (!limit || typeof limit !== "object") return null;
      const id = String(limit.id || "").slice(0, 120);
      if (!id) return null;
      return {
        id,
        name: String(limit.name || id).slice(0, 120),
        primary: normalizeCachedWindow(limit.primary),
        secondary: normalizeCachedWindow(limit.secondary),
        credits: null,
        rateLimitReachedType: limit.rateLimitReachedType
          ? String(limit.rateLimitReachedType).slice(0, 80)
          : null,
        planType: limit.planType ? String(limit.planType).slice(0, 80) : null,
      };
    })
    .filter(Boolean);
  const availableCount = Number(value?.resetCredits?.availableCount);
  const upcoming = (Array.isArray(value?.resetCredits?.upcoming) ? value.resetCredits.upcoming : [])
    .map((credit) => ({
      title: String(credit?.title || "Usage reset").slice(0, 120),
      grantedAt: toIsoDate(credit?.grantedAt),
      expiresAt: toIsoDate(credit?.expiresAt),
    }))
    .filter((credit) => credit.expiresAt)
    .sort((left, right) => left.expiresAt.localeCompare(right.expiresAt))
    .slice(0, 3);

  return {
    status: "ready",
    installed: true,
    version: String(value.version || version).slice(0, 120),
    updatedAt,
    planType: value.planType ? String(value.planType).slice(0, 80) : null,
    defaultLimitId: value.defaultLimitId ? String(value.defaultLimitId).slice(0, 120) : null,
    resetCredits: Number.isFinite(availableCount) || upcoming.length
      ? {
          availableCount: Number.isFinite(availableCount)
            ? Math.max(0, Math.trunc(availableCount))
            : upcoming.length,
          upcoming,
        }
      : null,
    limits,
    error: "",
  };
}

async function readCachedSnapshot(cacheFile, version) {
  if (!cacheFile) return null;
  try {
    return normalizeCachedSnapshot(JSON.parse(await readFile(cacheFile, "utf8")), version);
  } catch {
    return null;
  }
}

async function persistSnapshot(cacheFile, snapshot) {
  if (!cacheFile || snapshot?.status !== "ready") return;
  await mkdir(path.dirname(cacheFile), { recursive: true });
  const temporaryFile = `${cacheFile}.${process.pid}.tmp`;
  try {
    await writeFile(temporaryFile, `${JSON.stringify(snapshot)}\n`, {
      encoding: "utf8",
      mode: 0o600,
    });
    await rename(temporaryFile, cacheFile);
  } catch (error) {
    await unlink(temporaryFile).catch(() => {});
    throw error;
  }
}

function protocolError(message, code = "CODEX_APP_SERVER_ERROR") {
  const error = new Error(message);
  error.code = code;
  return error;
}

async function readCodexAuth(options = {}) {
  const authPath = options.authPath
    || process.env.CODEX_AUTH_FILE
    || path.join(os.homedir(), ".codex", "auth.json");
  let auth;
  try {
    auth = JSON.parse(await readFile(authPath, "utf8"));
  } catch {
    throw protocolError("Codex authentication is unavailable", "CODEX_AUTH_UNAVAILABLE");
  }
  const accessToken = String(auth?.tokens?.access_token || "");
  const accountId = String(auth?.tokens?.account_id || "");
  if (!/^[A-Za-z0-9._-]+$/.test(accessToken) || !/^[A-Za-z0-9_-]+$/.test(accountId)) {
    throw protocolError("Codex authentication is unavailable", "CODEX_AUTH_UNAVAILABLE");
  }
  return { accessToken, accountId };
}

async function fetchCodexResetCredits(options = {}) {
  const command = options.command || process.env.CURL_BIN || "curl";
  const timeoutMs = options.timeoutMs || CODEX_USAGE_TIMEOUT_MS;
  const spawnImpl = options.spawnImpl || spawn;
  const endpoint = options.endpoint || CODEX_RESET_CREDITS_URL;
  const { accessToken, accountId } = await readCodexAuth(options);

  return new Promise((resolve, reject) => {
    let child;
    let settled = false;
    let output = "";

    const finish = (error, result) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      if (child && child.exitCode == null && child.signalCode == null) child.kill("SIGTERM");
      if (error) reject(error);
      else resolve(result);
    };

    const timeout = setTimeout(() => {
      finish(protocolError("Codex reset credits request timed out", "ETIMEDOUT"));
    }, timeoutMs);
    if (typeof timeout.unref === "function") timeout.unref();

    try {
      child = spawnImpl(command, [
        "--silent",
        "--show-error",
        "--fail",
        "--max-time",
        String(Math.max(1, Math.ceil(timeoutMs / 1000))),
        "--config",
        "-",
        endpoint,
      ], {
        stdio: ["pipe", "pipe", "ignore"],
      });
    } catch (error) {
      finish(error);
      return;
    }

    child.once("error", (error) => finish(error));
    child.stdin.on("error", () => {});
    child.stdout.on("data", (chunk) => {
      output += chunk.toString("utf8");
      if (Buffer.byteLength(output) > MAX_PROTOCOL_BUFFER_BYTES) {
        finish(protocolError("Codex reset credits response exceeded the safety limit"));
      }
    });
    child.once("close", (code) => {
      if (settled) return;
      if (code !== 0) {
        finish(protocolError("Codex reset credits endpoint is unavailable"));
        return;
      }
      try {
        finish(null, JSON.parse(output));
      } catch {
        finish(protocolError("Codex reset credits response was invalid"));
      }
    });

    child.stdin.end([
      `header = "Authorization: Bearer ${accessToken}"`,
      `header = "ChatGPT-Account-Id: ${accountId}"`,
      "header = \"Accept: application/json\"",
      "",
    ].join("\n"));
  });
}

function fetchCodexRateLimits(options = {}) {
  const command = options.command || process.env.CODEX_BIN || "codex";
  const timeoutMs = options.timeoutMs || CODEX_USAGE_TIMEOUT_MS;
  const spawnImpl = options.spawnImpl || spawn;

  return new Promise((resolve, reject) => {
    let child;
    let settled = false;
    let buffer = "";

    const finish = (error, result) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      try {
        child?.stdin?.end();
      } catch {
        // The process may already have closed after writing its response.
      }
      if (child && child.exitCode == null && child.signalCode == null) child.kill("SIGTERM");
      if (error) reject(error);
      else resolve(result);
    };

    const writeMessage = (message) => {
      child.stdin.write(`${JSON.stringify(message)}\n`);
    };

    const handleMessage = (message) => {
      const id = String(message?.id ?? "");
      if (id === "1") {
        if (message.error) {
          finish(protocolError("Codex app-server initialization failed"));
          return;
        }
        writeMessage({ method: "initialized" });
        writeMessage({ method: "account/rateLimits/read", id: 2 });
        return;
      }
      if (id !== "2") return;
      if (message.error) {
        finish(protocolError("Codex rate-limit endpoint is unavailable"));
        return;
      }
      finish(null, message.result || {});
    };

    const consumeBuffer = (flush = false) => {
      if (Buffer.byteLength(buffer) > MAX_PROTOCOL_BUFFER_BYTES) {
        finish(protocolError("Codex app-server response exceeded the safety limit"));
        return;
      }
      let newlineIndex;
      while ((newlineIndex = buffer.indexOf("\n")) >= 0) {
        const line = buffer.slice(0, newlineIndex).trim();
        buffer = buffer.slice(newlineIndex + 1);
        if (!line) continue;
        try {
          handleMessage(JSON.parse(line));
        } catch {
          // Ignore app-server diagnostics that are not JSON protocol messages.
        }
      }
      if (flush && buffer.trim()) {
        try {
          handleMessage(JSON.parse(buffer.trim()));
        } catch {
          // The final fragment was not a protocol message.
        }
        buffer = "";
      }
    };

    const timeout = setTimeout(() => {
      finish(protocolError("Codex usage request timed out", "ETIMEDOUT"));
    }, timeoutMs);
    if (typeof timeout.unref === "function") timeout.unref();

    try {
      child = spawnImpl(command, ["app-server", "--stdio"], {
        stdio: ["pipe", "pipe", "ignore"],
      });
    } catch (error) {
      finish(error);
      return;
    }

    child.once("error", (error) => finish(error));
    child.stdout.on("data", (chunk) => {
      buffer += chunk.toString("utf8");
      consumeBuffer();
    });
    child.once("close", () => {
      consumeBuffer(true);
      if (!settled) finish(protocolError("Codex app-server closed before returning usage data"));
    });

    writeMessage({
      method: "initialize",
      id: 1,
      params: {
        clientInfo: {
          name: "session-observer",
          title: "Session Observer",
          version: "0.1.0",
        },
        capabilities: {
          experimentalApi: false,
          requestAttestation: false,
        },
      },
    });
  });
}

function emptySnapshot(version = "unknown") {
  return {
    status: "idle",
    installed: null,
    version,
    updatedAt: null,
    planType: null,
    defaultLimitId: null,
    resetCredits: null,
    limits: [],
    error: "",
  };
}

function createCodexUsageService(options = {}) {
  const fetchRateLimits = options.fetchRateLimits || fetchCodexRateLimits;
  const fetchResetCredits = options.fetchResetCredits || fetchCodexResetCredits;
  const now = options.now || Date.now;
  const version = String(options.version || "unknown");
  const cacheFile = options.cacheFile || null;
  let state = emptySnapshot(version);
  let refreshPromise = null;
  let restorePromise = readCachedSnapshot(cacheFile, version).then((snapshot) => {
    if (snapshot) state = snapshot;
  });

  async function ensureRestored() {
    if (!restorePromise) return;
    await restorePromise;
    restorePromise = null;
  }

  async function refresh() {
    if (refreshPromise) return refreshPromise;
    refreshPromise = (async () => {
      await ensureRestored();
      const previous = state;
      if (state.status === "idle") state = { ...state, status: "loading" };
      const updatedAt = new Date(now()).toISOString();
      try {
        const result = await fetchRateLimits();
        let resetCreditsResult = null;
        try {
          resetCreditsResult = await fetchResetCredits();
        } catch {
          // Keep rate-limit windows and the summary count when credit details are unavailable.
        }
        const normalized = normalizeCodexUsageResult(result, {
          version,
          updatedAt,
          resetCreditsResult,
        });
        state = normalized;
        await persistSnapshot(cacheFile, state).catch(() => {});
      } catch (error) {
        const missing = error?.code === "ENOENT";
        state = previous.status === "ready"
          ? { ...previous, error: "Codex 使用额度更新失败，当前显示上次结果" }
          : {
              ...emptySnapshot(version),
              status: missing ? "not-installed" : "unavailable",
              installed: !missing,
              updatedAt,
              error: missing ? "" : "Codex 使用额度暂时无法读取",
            };
      }
      return state;
    })().finally(() => {
      refreshPromise = null;
    });
    return refreshPromise;
  }

  async function getSnapshot() {
    await ensureRestored();
    return {
      ...state,
      resetCredits: state.resetCredits
        ? { ...state.resetCredits, upcoming: [...state.resetCredits.upcoming] }
        : null,
      limits: [...state.limits],
    };
  }

  return {
    refresh,
    getSnapshot,
  };
}

module.exports = {
  CODEX_USAGE_TIMEOUT_MS,
  CODEX_RESET_CREDITS_URL,
  createCodexUsageService,
  fetchCodexRateLimits,
  fetchCodexResetCredits,
  normalizeCodexUsageResult,
  normalizeCachedSnapshot,
  normalizeRateLimitWindow,
  normalizeResetCredits,
};
