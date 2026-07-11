export const DEFAULT_STREAM_FILTERS = {
  query: "",
  model: "",
  type: "",
  platform: "",
  start: "",
  end: "",
  order: "desc",
};

export const DEFAULT_SESSION_FILTERS = {
  query: "",
  platform: "",
  namedOnly: false,
  groupBy: "cwd",
  tokenMin: "",
  tokenMax: "",
  maxEvents: "",
};

export const DEFAULT_TOKEN_THRESHOLD = "20000";
export const APP_TABS = ["overview", "tokens", "stream", "sessions"];

function cleanSearch(search = "") {
  return String(search).replace(/^\?/, "");
}

function pickEnum(value, allowed, fallback) {
  return allowed.includes(value) ? value : fallback;
}

function normalizeTab(value) {
  if (value === "alerts" || value === "insights") return "overview";
  return pickEnum(value, APP_TABS, "stream");
}

function normalizeText(value) {
  return String(value || "").trim();
}

function normalizeThreshold(value) {
  const raw = normalizeText(value);
  if (!raw) return DEFAULT_TOKEN_THRESHOLD;
  const parsed = Number(raw);
  if (!Number.isFinite(parsed) || parsed <= 0) return DEFAULT_TOKEN_THRESHOLD;
  return String(Math.round(parsed));
}

export function parseUrlState(search = "") {
  const params = new URLSearchParams(cleanSearch(search));

  return {
    tab: normalizeTab(params.get("tab")),
    selectedSessionId: normalizeText(params.get("session")),
    mode: pickEnum(params.get("mode"), ["observe", "raw"], "observe"),
    quickFilter: pickEnum(params.get("qf"), ["all", "high_token"], "all"),
    tokenThreshold: normalizeThreshold(params.get("tt")),
    streamFilters: {
      ...DEFAULT_STREAM_FILTERS,
      query: normalizeText(params.get("q")),
      model: normalizeText(params.get("model")),
      type: normalizeText(params.get("type")),
      platform: normalizeText(params.get("platform")),
      start: normalizeText(params.get("from")),
      end: normalizeText(params.get("to")),
      order: pickEnum(params.get("sort"), ["asc", "desc"], DEFAULT_STREAM_FILTERS.order),
    },
    sessionFilters: {
      ...DEFAULT_SESSION_FILTERS,
      query: normalizeText(params.get("sq")),
      platform: normalizeText(params.get("sp")),
      namedOnly: params.get("named") === "1",
      groupBy: pickEnum(params.get("sg"), ["cwd", "sourceFile", "platform"], DEFAULT_SESSION_FILTERS.groupBy),
      tokenMin: normalizeText(params.get("stmin")),
      tokenMax: normalizeText(params.get("stmax")),
      maxEvents: normalizeText(params.get("semax")),
    },
  };
}

export function buildUrlSearch(state = {}) {
  const params = new URLSearchParams();
  const tab = normalizeTab(state.tab);
  const mode = pickEnum(state.mode, ["observe", "raw"], "observe");
  const quickFilter = pickEnum(state.quickFilter, ["all", "high_token"], "all");
  const tokenThreshold = normalizeThreshold(state.tokenThreshold);
  const streamFilters = {
    ...DEFAULT_STREAM_FILTERS,
    ...(state.streamFilters || {}),
  };
  const sessionFilters = {
    ...DEFAULT_SESSION_FILTERS,
    ...(state.sessionFilters || {}),
  };
  const selectedSessionId = normalizeText(state.selectedSessionId);
  const isServerSource = state.dataSource !== "local";

  if (tab !== "stream") params.set("tab", tab);
  if (isServerSource && selectedSessionId) params.set("session", selectedSessionId);
  if (normalizeText(streamFilters.query)) params.set("q", normalizeText(streamFilters.query));
  if (normalizeText(streamFilters.model)) params.set("model", normalizeText(streamFilters.model));
  if (normalizeText(streamFilters.type)) params.set("type", normalizeText(streamFilters.type));
  if (normalizeText(streamFilters.platform)) params.set("platform", normalizeText(streamFilters.platform));
  if (quickFilter !== "all") params.set("qf", quickFilter);
  if (mode !== "observe") params.set("mode", mode);
  if (streamFilters.order !== DEFAULT_STREAM_FILTERS.order) params.set("sort", streamFilters.order);
  if (normalizeText(streamFilters.start)) params.set("from", normalizeText(streamFilters.start));
  if (normalizeText(streamFilters.end)) params.set("to", normalizeText(streamFilters.end));
  if (tokenThreshold !== DEFAULT_TOKEN_THRESHOLD) params.set("tt", tokenThreshold);
  if (normalizeText(sessionFilters.query)) params.set("sq", normalizeText(sessionFilters.query));
  if (normalizeText(sessionFilters.platform)) params.set("sp", normalizeText(sessionFilters.platform));
  if (sessionFilters.namedOnly) params.set("named", "1");
  if (sessionFilters.groupBy !== DEFAULT_SESSION_FILTERS.groupBy) params.set("sg", sessionFilters.groupBy);
  if (normalizeText(sessionFilters.tokenMin)) params.set("stmin", normalizeText(sessionFilters.tokenMin));
  if (normalizeText(sessionFilters.tokenMax)) params.set("stmax", normalizeText(sessionFilters.tokenMax));
  if (normalizeText(sessionFilters.maxEvents)) params.set("semax", normalizeText(sessionFilters.maxEvents));

  return params.toString();
}
