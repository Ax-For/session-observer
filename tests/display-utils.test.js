const test = require("node:test");
const assert = require("node:assert/strict");

const {
  TOOL_DISPLAY_CONFIGS,
  getToolConfig,
  escapeHtml,
  highlightMatch,
  shortModel,
  fmtTokenHuman,
  hasTokenUsageData,
  rowHeightForDensity,
  sessionRowHeightForDensity,
  formatShanghaiTime,
  highlightJson,
} = require("../app/utils/display");

test("display utils return known tool configs and fallback defaults", () => {
  assert.equal(getToolConfig("Bash"), TOOL_DISPLAY_CONFIGS.Bash);
  assert.equal(getToolConfig("Missing"), TOOL_DISPLAY_CONFIGS.Default);
});

test("display utils escape, highlight, and shorten values", () => {
  assert.equal(escapeHtml('<div>"x"</div>'), "&lt;div&gt;&quot;x&quot;&lt;/div&gt;");
  assert.equal(highlightMatch("Alpha beta", "beta"), "Alpha <mark>beta</mark>");
  assert.equal(shortModel("claude-sonnet-4-6"), "sonnet-4");
  assert.equal(shortModel("gpt-5.4"), "gpt-5.4");
});

test("display utils format tokens, density, and token usage guards", () => {
  assert.equal(fmtTokenHuman(1200), "1.2k");
  assert.equal(fmtTokenHuman(2500000), "2.5m");
  assert.equal(rowHeightForDensity("compact"), 40);
  assert.equal(rowHeightForDensity("cozy"), 48);
  assert.equal(sessionRowHeightForDensity("compact"), 72);
  assert.equal(sessionRowHeightForDensity("cozy"), 84);
  assert.equal(hasTokenUsageData({ total: 1 }), true);
  assert.equal(hasTokenUsageData({ total: null }), false);
});

test("display utils format timestamps and syntax-highlight json", () => {
  const shanghai = formatShanghaiTime("2026-04-19T12:34:56.789Z");
  assert.match(shanghai, /^2026-04-19 20:34:56\.789$/);

  const html = highlightJson({ ok: true, count: 2, label: "done" });
  assert.match(html, /json-key/);
  assert.match(html, /json-boolean/);
  assert.match(html, /json-number/);
  assert.match(html, /json-string/);
});
