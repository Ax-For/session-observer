const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const { execFileSync } = require("child_process");
const pricing = require("../shared/token-pricing");
const insights = require("../shared/session-insights");
const core = require("../shared/observer-core");
const { buildResponsePerformance } = require("../shared/response-performance");
const sessionTokens = (session) => session?.aggregateToken?.effectiveTotal ?? core.tokenCountedTotal(session?.aggregateToken, session?.sourceType);

function readJson(file, fallback) {
  try {
    if (fs.statSync(file).size > 4 * 1024 * 1024) throw new Error("Local analysis file is too large");
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch (error) {
    if (error.code === "ENOENT") return fallback;
    throw error;
  }
}

function writeJson(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const temporary = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(temporary, JSON.stringify(value), { mode: 0o600 });
  fs.renameSync(temporary, file);
}

function createAnalysisServices(directory) {
  const localFile = path.join(directory, "workspace-library.json");
  const auditFile = path.join(directory, "statistics-audit.json");
  const priceFile = process.env.OBSERVER_PRICEBOOK_FILE || path.join(directory, "pricebook.json");
  const library = () => readJson(localFile, { views: [], bookmarks: [] });
  function saveLibrary(kind, value) {
    if (!["views", "bookmarks"].includes(kind)) throw new Error("Invalid library collection");
    const state = library();
    if (!Array.isArray(state[kind])) throw new Error("Invalid local library");
    const id = String(value.id || crypto.randomUUID()).slice(0, 400);
    state[kind] = state[kind].filter((item) => item.id !== id);
    if (!value.remove) {
      if (state[kind].length >= 200) throw new Error("Library limit reached (200 items)");
      const item = { id, label: String(value.label || "").trim().slice(0, 120), updatedAt: new Date().toISOString() };
      if (kind === "views") {
        item.filters = Object.fromEntries(["q", "model", "type", "platform", "sessionId", "mode", "order", "quickFilter", "start", "end", "view"]
          .filter((key) => typeof value.filters?.[key] === "string").map((key) => [key, value.filters[key].slice(0, 500)]));
        if (Number.isFinite(Number(value.filters?.tokenThreshold))) item.filters.tokenThreshold = Math.max(0, Number(value.filters.tokenThreshold));
      } else {
        if (!value.eventId || !value.sessionId) throw new Error("Message and session identifiers required");
        item.eventId = String(value.eventId).slice(0, 400);
        item.sessionId = String(value.sessionId).slice(0, 200);
        item.time = String(value.time || "").slice(0, 50);
        item.note = String(value.note || "").slice(0, 1000);
      }
      state[kind].unshift(item);
    }
    writeJson(localFile, state);
    return state;
  }
  function pricebook() { return readJson(priceFile, { rates: [] }); }
  function loadPrices() {
    const book = pricebook();
    pricing.configureRates(book.rates);
    return crypto.createHash("sha256").update(JSON.stringify(book.rates)).digest("hex").slice(0, 16);
  }
  function savePrices(value) {
    const rates = pricing.configureRates(value.rates);
    writeJson(priceFile, { rates, updatedAt: new Date().toISOString() });
    return pricebook();
  }
  const audit = () => readJson(auditFile, { runs: [], snapshot: null });
  function capture(summary) {
    return { at: summary.generatedAt, pricingVersion: summary.provenance?.pricingVersion || pricing.PRICING_VERSION,
      parserVersion: summary.provenance?.parserVersion || null,
      tokens: summary.tokens?.usage?.effectiveTotal ?? summary.tokens?.effectiveTotal ?? summary.tokens?.total ?? 0,
      cost: summary.tokens?.cost?.estimatedUsd || 0,
      models: summary.tokens?.cost?.byModel || [],
      sessions: (summary.sessions?.groups || []).map((session) => ({ id: session.sessionId,
        tokens: sessionTokens(session), cost: session.estimatedUsd || 0 })) };
  }
  function recordAudit(before, after, metadata = {}) {
    const state = audit();
    const old = before || state.snapshot;
    const prior = new Map((old?.sessions || []).map((row) => [row.id, row]));
    const next = new Map(after.sessions.map((row) => [row.id, row]));
    const changes = [...new Set([...prior.keys(), ...next.keys()])].map((id) => ({ id,
      before: prior.get(id) || { tokens: 0, cost: 0 }, after: next.get(id) || { tokens: 0, cost: 0 } }))
      .filter((row) => row.before.tokens !== row.after.tokens || Math.abs(row.before.cost - row.after.cost) > 1e-8);
    const run = { id: crypto.randomUUID(), at: new Date().toISOString(), ...metadata,
      previousVersion: old?.pricingVersion || null, pricingVersion: after.pricingVersion,
      previousParserVersion: old?.parserVersion || null, parserVersion: after.parserVersion || null,
      before: old ? { tokens: old.tokens, cost: old.cost } : null,
      after: { tokens: after.tokens, cost: after.cost },
      changeCount: changes.length, changes: changes.slice(0, 200), changesTruncated: changes.length > 200 };
    state.runs = [run, ...state.runs].slice(0, 10);
    state.snapshot = after;
    writeJson(auditFile, state);
    return run;
  }
  return { library, saveLibrary, pricebook, loadPrices, savePrices, audit, capture, recordAudit };
}

function analyzeTurns(events) {
  const replay = insights.buildExecutionReplay(events, { limit: 1000 });
  const replayIds = new Set(replay.steps.map((step) => step.eventId));
  const ordered = [...events].sort((a, b) => String(a.time).localeCompare(String(b.time)));
  const turns = [];
  let turn;
  for (const event of ordered) {
    const kind = insights.eventKind(event);
    if (["user", "agent"].includes(kind) && event.eventId && !replayIds.has(event.eventId)) continue;
    if (kind === "user" || !turn) {
      turn = { id: event.eventId, time: event.time, title: kind === "user" ? String(event.content || "").slice(0, 120) : "窗口开始前的轮次",
        partial: kind !== "user", tokens: 0, cost: 0, unpricedTokens: 0, tools: 0, pairedTools: 0, toolTimeMs: 0 };
      turns.push(turn);
    }
    if (kind === "usage") {
      const tokens = core.tokenCountedTotal(event.tokenUsage, event.sourceType);
      const estimate = pricing.estimateTokenCost(event.tokenUsage, event.model, { time: event.time, speed: event.serviceTier, recordedUsd: event.recordedCostUsd });
      turn.tokens += tokens;
      turn.cost += estimate.estimatedUsd;
      if (!estimate.known) turn.unpricedTokens += tokens;
    }
    if (kind === "tool-call") {
      turn.tools += 1;
      const step = replay.steps.find((item) => item.eventId === event.eventId);
      if (step?.durationMs != null) { turn.pairedTools += 1; turn.toolTimeMs += step.durationMs; }
    }
  }
  return { turns: turns.filter((item) => !item.partial || item.tokens || item.tools), scope: "loaded-event-window", events: events.length, pricingVersion: pricing.PRICING_VERSION,
    timingBasis: "call-id; parallel durations are summed, not wall-clock latency", performance: buildResponsePerformance(events) };
}

function agentRelations(sessions, sessionId) {
  const byId = new Map(sessions.map((item) => [item.sessionId, item]));
  const session = byId.get(sessionId);
  const descendants = [];
  const visited = new Set([sessionId]);
  const visit = (id, depth) => {
    if (depth > 20) return;
    for (const item of sessions) if (item.parentSessionId === id && !visited.has(item.sessionId)) {
      visited.add(item.sessionId);
      descendants.push({ ...item, depth, attributedTokens: sessionTokens(item) });
      visit(item.sessionId, depth + 1);
    }
  };
  visit(sessionId, 1);
  return { parent: session?.parentSessionId !== sessionId ? byId.get(session?.parentSessionId) || null : null, children: descendants,
    ownTokens: sessionTokens(session), ownCost: session?.estimatedUsd || 0,
    childTokens: descendants.reduce((sum, item) => sum + item.attributedTokens, 0),
    childCost: descendants.reduce((sum, item) => sum + (item.estimatedUsd || 0), 0),
    attribution: "exclusive-source-logs; inclusive totals are not added to global totals" };
}

function gitEvidence(session) {
  const cwd = session?.cwd;
  if (!cwd || !fs.existsSync(cwd)) return { available: false, reason: "工作目录不存在" };
  const start = Date.parse(session.startedAt);
  const end = Date.parse(session.latest);
  if (!Number.isFinite(start) || !Number.isFinite(end)) return { available: false, reason: "会话时间不完整" };
  const git = (args) => execFileSync("git", ["--no-pager", "-c", "core.fsmonitor=false", "-c", "core.hooksPath=/dev/null", ...args], {
    cwd, encoding: "utf8", timeout: 5000, maxBuffer: 256 * 1024, env: { ...process.env, GIT_OPTIONAL_LOCKS: "0", GIT_PAGER: "cat" }, stdio: ["ignore", "pipe", "pipe"],
  }).trim();
  try {
    const root = git(["rev-parse", "--show-toplevel"]);
    const lines = git(["log", "--all", "--no-show-signature", "-n", "51", `--since=${new Date(start).toISOString()}`, `--until=${new Date(end).toISOString()}`,
      "--format=%H%x09%cI%x09%s", "--"]);
    const commits = lines ? lines.split("\n").map((line) => {
      const [hash, time, ...subject] = line.split("\t");
      return { hash, time, subject: subject.join("\t").slice(0, 300) };
    }) : [];
    const edited = (session.editedFiles || []).map((file) => path.relative(root, path.resolve(cwd, file)));
    return { available: true, root, commits: commits.slice(0, 50), truncated: commits.length > 50, editedFiles: edited,
      basis: "会话时间窗口内的仓库提交；时间相关不代表由该会话创建", checkedAt: new Date().toISOString() };
  } catch { return { available: false, reason: "无 Git 仓库、查询超时或输出超出限制" }; }
}

module.exports = { createAnalysisServices, analyzeTurns, agentRelations, gitEvidence };
