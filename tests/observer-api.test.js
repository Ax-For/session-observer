const test = require("node:test");
const assert = require("node:assert/strict");

const {
  buildEventsQuery,
  createApiClient,
} = require("../app/api/client");

test("buildEventsQuery serializes active stream filters", () => {
  const query = buildEventsQuery({
    mode: "observe",
    order: "desc",
    offset: 30,
    limit: 250,
    quickFilter: "high_token",
    tokenThreshold: 40000,
    q: "  timeout  ",
    platform: "claude",
    model: "claude-sonnet-4-6",
    type: "Agent",
    start: "2026-04-19T09:00",
    end: "2026-04-19T10:00",
    sessionId: "sess-1",
  });

  const params = new URLSearchParams(query);
  assert.equal(params.get("mode"), "observe");
  assert.equal(params.get("order"), "desc");
  assert.equal(params.get("offset"), "30");
  assert.equal(params.get("limit"), "250");
  assert.equal(params.get("quickFilter"), "high_token");
  assert.equal(params.get("tokenThreshold"), "40000");
  assert.equal(params.get("q"), "timeout");
  assert.equal(params.get("platform"), "claude");
  assert.equal(params.get("model"), "claude-sonnet-4-6");
  assert.equal(params.get("type"), "Agent");
  assert.equal(params.get("start"), "2026-04-19T09:00");
  assert.equal(params.get("end"), "2026-04-19T10:00");
  assert.equal(params.get("sessionId"), "sess-1");
});

test("createApiClient.listRealtimeEvents requests no-store event pages", async () => {
  const calls = [];
  const client = createApiClient({
    fetchImpl: async (url, options) => {
      calls.push({ url, options });
      return {
        ok: true,
        async json() {
          return { events: [{ sessionId: "sess-1" }], totalMatching: 1 };
        },
      };
    },
  });

  const payload = await client.listRealtimeEvents({
    mode: "observe",
    order: "desc",
    offset: 0,
    limit: 100,
    quickFilter: "all",
    tokenThreshold: 20000,
    q: "prompt",
  });

  assert.equal(payload.totalMatching, 1);
  assert.equal(calls.length, 1);
  assert.match(calls[0].url, /^\/api\/events\?/);
  assert.equal(calls[0].options.cache, "no-store");
});

test("createApiClient.renameSession posts json and surfaces api errors", async () => {
  const calls = [];
  const client = createApiClient({
    fetchImpl: async (url, options) => {
      calls.push({ url, options });
      return {
        ok: false,
        status: 409,
        async json() {
          return { error: "session title already exists" };
        },
      };
    },
  });

  await assert.rejects(
    () => client.renameSession({ sessionId: "sess-9", newName: "Release Review" }),
    /session title already exists/
  );

  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, "/api/sessions/rename");
  assert.equal(calls[0].options.method, "POST");
  assert.equal(calls[0].options.headers["Content-Type"], "application/json");
  assert.deepEqual(JSON.parse(calls[0].options.body), {
    sessionId: "sess-9",
    newName: "Release Review",
  });
});

test("createApiClient.exportSessionEvents flattens successful session fetches", async () => {
  const urls = [];
  const client = createApiClient({
    fetchImpl: async (url) => {
      urls.push(url);
      if (url.includes("sessionId=sess-2")) {
        return { ok: false, status: 500, async json() { return {}; } };
      }
      return {
        ok: true,
        async json() {
          return {
            events: [
              {
                sessionId: "sess-1",
                time: "2026-04-19T10:00:00.000Z",
                callType: "Agent",
                model: "gpt-5.4",
                content: "Done",
                tokenUsage: { total: 12 },
              },
            ],
          };
        },
      };
    },
  });

  const exportData = await client.exportSessionEvents(["sess-1", "sess-2"]);

  assert.equal(urls.length, 2);
  assert.equal(exportData.length, 1);
  assert.deepEqual(exportData[0], {
    sessionId: "sess-1",
    time: "2026-04-19T10:00:00.000Z",
    callType: "Agent",
    model: "gpt-5.4",
    content: "Done",
    tokenUsage: { total: 12 },
  });
});
