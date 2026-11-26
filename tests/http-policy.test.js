const { test } = require("node:test");
const assert = require("node:assert/strict");
const { policyError } = require("../server/http-policy");

test("cross-site top-level links can open the app shell without exposing API data", () => {
  const options = { port: 8787, host: "127.0.0.1" };
  const request = { method: "GET", url: "/?tab=overview", headers: { host: "127.0.0.1:8787",
    "sec-fetch-site": "cross-site", "sec-fetch-mode": "navigate", "sec-fetch-dest": "document" } };
  assert.equal(policyError(request, options), null);
  assert.equal(policyError({ ...request, url: "/index.html" }, options), null);
  for (const url of ["/api/sessions", "/api/live-speed", "/api/live-speed/snapshot", "/api/events", "/assets/app.js"]) {
    assert.equal(policyError({ ...request, url }, options)?.[0], 403, url);
  }
  for (const mode of ["cors", "no-cors", "same-origin"]) {
    assert.equal(policyError({ ...request, headers: { ...request.headers, "sec-fetch-mode": mode } }, options)?.[0], 403);
  }
  for (const dest of ["iframe", "image", "script", "empty"]) {
    assert.equal(policyError({ ...request, headers: { ...request.headers, "sec-fetch-dest": dest } }, options)?.[0], 403);
  }
  assert.equal(policyError({ ...request, method: "POST" }, options)?.[0], 403);
  assert.equal(policyError({ ...request, headers: { ...request.headers, origin: "https://evil.example" } }, options)?.[0], 403);
  assert.equal(policyError({ ...request, headers: { ...request.headers, host: "evil.example:8787" } }, options)?.[0], 403);
  assert.equal(policyError(request, { ...options, token: "test-only" })?.[0], 401);
});

test("local API rejects foreign origins, oversized bodies and source mutations by default", () => {
  const options = { port: 8787, host: "127.0.0.1" };
  const request = { method: "POST", url: "/api/sessions/batch-delete", headers: { host: "127.0.0.1:8787", "x-observer-request": "1" } };
  assert.equal(policyError(request, options)[0], 403);
  assert.equal(policyError(request, { ...options, allowSourceMutations: true }), null);
  assert.equal(policyError({ ...request, headers: { ...request.headers, origin: "https://evil.example" } }, options)[0], 403);
  assert.equal(policyError({ ...request, url: "/api/observability/recalculate", headers: { ...request.headers, "content-length": 70000 } }, options)[0], 413);
  assert.equal(policyError({ ...request, method: "GET", url: "/api/sessions" }, { ...options, token: "test-only" })[0], 401);
});
