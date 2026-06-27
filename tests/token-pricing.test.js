const assert = require("node:assert/strict");
const { test } = require("node:test");

const tokenPricing = require("../shared/token-pricing");

test("estimates GPT-5.5 Codex standard and fast pricing from token buckets", () => {
  const usage = {
    input: 1_539_806,
    cacheReadInput: 17_186_176,
    output: 61_450,
  };

  const standard = tokenPricing.estimateTokenCost(usage, "gpt-5.5", { speed: "standard" });
  const fast = tokenPricing.estimateTokenCost(usage, "gpt-5.5", { speed: "fast" });

  assert.equal(standard.known, true);
  assert.equal(standard.estimatedUsd, 18.135618);
  assert.equal(fast.known, true);
  assert.equal(fast.estimatedUsd, 45.339045);
});

test("estimates GPT-5.4 Codex fast pricing with model-specific multiplier", () => {
  const usage = {
    input: 100_756,
    cacheReadInput: 1_259_776,
    output: 11_402,
  };

  const standard = tokenPricing.estimateTokenCost(usage, "gpt-5.4", { speed: "standard" });
  const fast = tokenPricing.estimateTokenCost(usage, "gpt-5.4", { speed: "fast" });

  assert.equal(standard.estimatedUsd, 0.737864);
  assert.equal(fast.estimatedUsd, 1.475728);
});

test("uses Codex fallback fast multiplier for GPT-5.3 Codex models", () => {
  const usage = {
    input: 363_821,
    cacheReadInput: 756_608,
    output: 3_991,
  };

  const standard = tokenPricing.estimateTokenCost(usage, "gpt-5.3-codex", { speed: "standard" });
  const fast = tokenPricing.estimateTokenCost(usage, "gpt-5.3-codex", { speed: "fast" });

  assert.equal(standard.estimatedUsd, 0.82496715);
  assert.equal(fast.estimatedUsd, 1.6499343);
});

test("keeps reasoning tokens as display-only cost metadata", () => {
  const usage = {
    input: 1_000_000,
    output: 1_000_000,
    reasoningOutput: 1_000_000,
  };

  const estimate = tokenPricing.estimateTokenCost(usage, "gpt-5.5", { speed: "standard" });

  assert.equal(estimate.estimatedUsd, 35);
  assert.equal(estimate.knownTokenTotal, 2_000_000);
});
