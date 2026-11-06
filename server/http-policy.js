const crypto = require("crypto");
const { StringDecoder } = require("string_decoder");

function isAppShellNavigation(req) {
  if (req.method !== "GET" || req.headers["sec-fetch-mode"] !== "navigate" || req.headers["sec-fetch-dest"] !== "document") return false;
  try {
    const pathname = new URL(req.url, "http://localhost").pathname;
    return pathname === "/" || pathname === "/index.html";
  } catch { return false; }
}

function policyError(req, options = {}) {
  const host = String(req.headers.host || "");
  const allowedHosts = new Set([`localhost:${options.port}`, `127.0.0.1:${options.port}`, `[::1]:${options.port}`, `${options.host}:${options.port}`, ...(options.allowedHosts || [])]);
  if (!allowedHosts.has(host)) return [403, "Untrusted Host"];
  // External links may open the public app shell. API fetches, embeds and writes
  // must still pass the existing host, origin, authentication and request checks.
  if (req.headers["sec-fetch-site"] === "cross-site" && !isAppShellNavigation(req)) return [403, "Cross-site requests are not allowed"];
  if (req.headers.origin && req.headers.origin !== `http://${host}` && req.headers.origin !== `https://${host}`) return [403, "Untrusted Origin"];
  if (options.token) {
    if (!String(req.headers.authorization || "").startsWith("Basic ")) return [401, "Authentication required"];
    const encoded = String(req.headers.authorization || "").replace(/^Basic /, "");
    const value = Buffer.from(encoded, "base64").toString().split(":").slice(1).join(":");
    const a = crypto.createHash("sha256").update(value).digest();
    const b = crypto.createHash("sha256").update(options.token).digest();
    if (!crypto.timingSafeEqual(a, b)) return [401, "Authentication required"];
  }
  if (!["GET", "HEAD", "OPTIONS"].includes(req.method) && req.headers["x-observer-request"] !== "1") return [403, "Missing request protection header"];
  if (req.method !== "GET" && /\/api\/sessions\/(rename|batch-delete)|\/api\/sessions\/[^/]+$/.test(req.url)
    && !options.allowSourceMutations) return [403, "Source transcripts are read-only; enable OBSERVER_ALLOW_SOURCE_MUTATIONS explicitly"];
  if (Number(req.headers["content-length"]) > 64 * 1024) return [413, "Request body exceeds 64 KiB"];
  return null;
}

function readBody(req, res, respond, callback) {
  const decoder = new StringDecoder("utf8");
  let body = "";
  let bytes = 0;
  let rejected = false;
  req.on("data", (chunk) => {
    bytes += chunk.length;
    if (bytes > 64 * 1024) {
      if (!rejected) respond(req, res, 413, { error: "Request body exceeds 64 KiB" });
      rejected = true;
      body = "";
      return;
    }
    if (!rejected) body += decoder.write(chunk);
  });
  req.on("end", () => {
    if (rejected) return;
    body += decoder.end();
    let payload;
    try { payload = body ? JSON.parse(body) : {}; }
    catch { respond(req, res, 400, { error: "Invalid JSON body" }); return; }
    callback(payload);
  });
  req.on("error", () => { rejected = true; });
}

module.exports = { policyError, readBody };
