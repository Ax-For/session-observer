const test = require("node:test");
const assert = require("node:assert/strict");
const { mkdtemp, readFile, rm } = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");

const {
  createCodexUsageService,
  normalizeCodexUsageResult,
  normalizeResetCredits,
} = require("../server/codex-usage");

const RATE_LIMIT_RESULT = {
  rateLimits: {
    limitId: "codex",
    limitName: null,
    primary: {
      usedPercent: 37,
      windowDurationMins: 300,
      resetsAt: 1_783_793_048,
    },
    secondary: {
      usedPercent: 23,
      windowDurationMins: 10_080,
      resetsAt: 1_784_354_554,
    },
    credits: {
      hasCredits: false,
      unlimited: false,
      balance: "0",
    },
    individualLimit: null,
    planType: "pro",
    rateLimitReachedType: null,
  },
  rateLimitsByLimitId: {
    codex: {
      limitId: "codex",
      limitName: null,
      primary: {
        usedPercent: 37,
        windowDurationMins: 300,
        resetsAt: 1_783_793_048,
      },
      secondary: {
        usedPercent: 23,
        windowDurationMins: 10_080,
        resetsAt: 1_784_354_554,
      },
      planType: "pro",
    },
    codex_spark: {
      limitId: "codex_spark",
      limitName: "GPT-5.3-Codex-Spark",
      primary: {
        usedPercent: 0,
        windowDurationMins: 300,
        resetsAt: 1_783_798_793,
      },
      secondary: null,
      planType: "pro",
    },
  },
  rateLimitResetCredits: {
    availableCount: 4,
  },
};

const RESET_CREDITS_RESULT = {
  available_count: 4,
  credits: [
    {
      status: "available",
      title: "Full reset (Weekly + 5 hr)",
      granted_at: "2026-07-01T19:46:11.130667Z",
      expires_at: "2026-07-31T19:46:11.130667Z",
    },
    {
      status: "available",
      title: "Full reset (Weekly + 5 hr)",
      granted_at: "2026-06-12T01:13:49.745476Z",
      expires_at: "2026-07-12T01:13:49.745476Z",
    },
    {
      status: "redeemed",
      title: "Already used",
      granted_at: "2026-06-10T00:00:00.000Z",
      expires_at: "2026-07-10T00:00:00.000Z",
    },
    {
      status: "available",
      title: "Full reset (Weekly + 5 hr)",
      granted_at: "2026-06-26T23:06:47.568422Z",
      expires_at: "2026-07-26T23:06:47.568422Z",
    },
    {
      status: "available",
      title: "Full reset (Weekly + 5 hr)",
      granted_at: "2026-06-18T00:28:24.834578Z",
      expires_at: "2026-07-18T00:28:24.834578Z",
    },
  ],
};

test("normalizeResetCredits keeps the three nearest exact expirations", () => {
  assert.deepEqual(normalizeResetCredits(RESET_CREDITS_RESULT, 2), {
    availableCount: 4,
    upcoming: [
      {
        title: "Full reset (Weekly + 5 hr)",
        grantedAt: "2026-06-12T01:13:49.745Z",
        expiresAt: "2026-07-12T01:13:49.745Z",
      },
      {
        title: "Full reset (Weekly + 5 hr)",
        grantedAt: "2026-06-18T00:28:24.834Z",
        expiresAt: "2026-07-18T00:28:24.834Z",
      },
      {
        title: "Full reset (Weekly + 5 hr)",
        grantedAt: "2026-06-26T23:06:47.568Z",
        expiresAt: "2026-07-26T23:06:47.568Z",
      },
    ],
  });
});

test("normalizeCodexUsageResult keeps compact quota windows and exact reset instants", () => {
  const payload = normalizeCodexUsageResult(RATE_LIMIT_RESULT, {
    version: "codex-cli 0.142.3",
    updatedAt: "2026-07-11T13:20:00.000Z",
    resetCreditsResult: RESET_CREDITS_RESULT,
  });

  assert.equal(payload.status, "ready");
  assert.equal(payload.installed, true);
  assert.equal(payload.version, "codex-cli 0.142.3");
  assert.equal(payload.planType, "pro");
  assert.equal(payload.defaultLimitId, "codex");
  assert.equal(payload.resetCredits.availableCount, 4);
  assert.equal(payload.resetCredits.upcoming.length, 3);
  assert.equal(payload.resetCredits.upcoming[0].expiresAt, "2026-07-12T01:13:49.745Z");
  assert.equal(payload.limits.length, 2);
  assert.deepEqual(payload.limits[0].primary, {
    usedPercent: 37,
    remainingPercent: 63,
    windowDurationMinutes: 300,
    resetsAt: "2026-07-11T18:04:08.000Z",
  });
  assert.equal(payload.limits[0].secondary.remainingPercent, 77);
  assert.equal(payload.limits[1].name, "GPT-5.3-Codex-Spark");
});

test("createCodexUsageService stays idle until each explicit refresh", async () => {
  let nowMs = Date.parse("2026-07-11T13:20:00.000Z");
  let fetchCount = 0;
  let resetFetchCount = 0;
  const service = createCodexUsageService({
    version: "codex-cli test",
    now: () => nowMs,
    fetchRateLimits: async () => {
      fetchCount += 1;
      return RATE_LIMIT_RESULT;
    },
    fetchResetCredits: async () => {
      resetFetchCount += 1;
      return RESET_CREDITS_RESULT;
    },
  });

  const idle = await service.getSnapshot();
  assert.equal(idle.status, "idle");
  assert.equal(fetchCount, 0);
  assert.equal(resetFetchCount, 0);

  const first = await service.refresh();
  assert.equal(fetchCount, 1);
  assert.equal(resetFetchCount, 1);
  assert.equal(first.status, "ready");
  assert.equal(first.resetCredits.upcoming.length, 3);
  assert.equal((await service.getSnapshot()).updatedAt, first.updatedAt);

  nowMs += 60_000;
  const second = await service.refresh();
  assert.equal(fetchCount, 2);
  assert.equal(resetFetchCount, 2);
  assert.equal(second.updatedAt, "2026-07-11T13:21:00.000Z");
});

test("createCodexUsageService keeps quota data when reset credit details fail", async () => {
  const service = createCodexUsageService({
    fetchRateLimits: async () => RATE_LIMIT_RESULT,
    fetchResetCredits: async () => { throw new Error("reset credits unavailable"); },
  });

  const snapshot = await service.refresh();
  assert.equal(snapshot.status, "ready");
  assert.deepEqual(snapshot.resetCredits, { availableCount: 4, upcoming: [] });
});

test("createCodexUsageService persists and restores the last successful snapshot", async (context) => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "session-observer-codex-usage-"));
  const cacheFile = path.join(directory, "codex-usage.json");
  context.after(() => rm(directory, { recursive: true, force: true }));

  const writer = createCodexUsageService({
    cacheFile,
    now: () => Date.parse("2026-07-11T13:20:00.000Z"),
    version: "codex-cli test",
    fetchRateLimits: async () => RATE_LIMIT_RESULT,
    fetchResetCredits: async () => RESET_CREDITS_RESULT,
  });
  await writer.refresh();

  const persisted = JSON.parse(await readFile(cacheFile, "utf8"));
  assert.equal(persisted.updatedAt, "2026-07-11T13:20:00.000Z");
  assert.equal(persisted.resetCredits.upcoming.length, 3);

  let queryCount = 0;
  const reader = createCodexUsageService({
    cacheFile,
    version: "codex-cli test",
    fetchRateLimits: async () => {
      queryCount += 1;
      return RATE_LIMIT_RESULT;
    },
  });
  const restored = await reader.getSnapshot();
  assert.equal(restored.status, "ready");
  assert.equal(restored.updatedAt, "2026-07-11T13:20:00.000Z");
  assert.equal(restored.resetCredits.availableCount, 4);
  assert.equal(queryCount, 0);
});

test("createCodexUsageService distinguishes a missing CLI from an unreadable account", async () => {
  const missingError = new Error("spawn codex ENOENT");
  missingError.code = "ENOENT";
  const missing = createCodexUsageService({
    fetchRateLimits: async () => { throw missingError; },
  });
  const missingSnapshot = await missing.refresh();
  assert.equal(missingSnapshot.status, "not-installed");
  assert.equal(missingSnapshot.installed, false);

  const unavailable = createCodexUsageService({
    fetchRateLimits: async () => { throw new Error("rate limit method unavailable"); },
  });
  const unavailableSnapshot = await unavailable.refresh();
  assert.equal(unavailableSnapshot.status, "unavailable");
  assert.equal(unavailableSnapshot.installed, true);
  assert.equal(unavailableSnapshot.error, "Codex 使用额度暂时无法读取");
});
