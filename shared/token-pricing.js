(function initTokenPricing(globalScope, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) {
    module.exports = api;
  }
  if (globalScope) {
    globalScope.ObserverTokenPricing = api;
  }
})(typeof globalThis !== "undefined" ? globalThis : this, function createTokenPricing() {
  "use strict";

  const PRICING_VERSION = "2026-07-12";

  const MODEL_PRICE_HINTS = [
    { match: /gpt-5\.5/i, input: 5, output: 30, cacheRead: 0.5, cacheCreation: 5, fastMultiplier: 2.5, source: "codex-rate-card" },
    { match: /gpt-5\.4-mini/i, input: 0.75, output: 4.52, cacheRead: 0.075, cacheCreation: 0.75, source: "codex-rate-card" },
    { match: /gpt-5\.4/i, input: 2.5, output: 15, cacheRead: 0.25, cacheCreation: 2.5, fastMultiplier: 2, source: "codex-rate-card" },
    { match: /gpt-5\.3-codex(?:-spark)?/i, input: 1.75, output: 14, cacheRead: 0.175, cacheCreation: 1.75, fastMultiplier: 2, source: "codex-estimate" },
    { match: /claude.*haiku/i, input: 0.8, output: 4, cacheRead: 0.08, cacheCreation: 1 },
    { match: /claude.*sonnet/i, input: 3, output: 15, cacheRead: 0.3, cacheCreation: 3.75 },
    { match: /claude.*opus/i, input: 15, output: 75, cacheRead: 1.5, cacheCreation: 18.75 },
    { match: /gpt-4\.1|gpt-4o/i, input: 2.5, output: 10, cacheRead: 0.25, cacheCreation: 2.5 },
    { match: /gpt-5/i, input: 5, output: 30, cacheRead: 0.5, cacheCreation: 5, fastMultiplier: 2, source: "codex-fallback" },
    { match: /qwen/i, input: 0.4, output: 1.2, cacheRead: 0.04, cacheCreation: 0.4 },
    { match: /deepseek/i, input: 0.27, output: 1.1, cacheRead: 0.027, cacheCreation: 0.27 },
    { match: /glm/i, input: 0.5, output: 1.5, cacheRead: 0.05, cacheCreation: 0.5 },
  ];

  function toNumber(value) {
    const num = Number(value);
    return Number.isFinite(num) ? num : 0;
  }

  function normalizeSpeedTier(value) {
    const text = String(value || "").trim().toLowerCase();
    if (text === "fast" || text === "priority") return "fast";
    return "standard";
  }

  function applySpeedTier(entry, options = {}) {
    const speed = normalizeSpeedTier(options.speed || options.serviceTier);
    const multiplier = speed === "fast" ? toNumber(entry.fastMultiplier) || 1 : 1;
    return {
      input: entry.input * multiplier,
      output: entry.output * multiplier,
      cacheRead: entry.cacheRead * multiplier,
      cacheCreation: entry.cacheCreation * multiplier,
      speed,
      source: entry.source || "built-in-estimate",
    };
  }

  function findModelPrice(model, options = {}) {
    const text = String(model || "");
    const entry = MODEL_PRICE_HINTS.find((item) => item.match.test(text));
    if (!entry) return null;
    return applySpeedTier(entry, options);
  }

  function estimateTokenCost(tokenUsage, model, options = {}) {
    const price = findModelPrice(model, options);
    const usage = tokenUsage || {};
    if (!price) {
      return {
        estimatedUsd: 0,
        known: false,
        knownTokenTotal: 0,
      };
    }

    const input = toNumber(usage.input);
    const output = toNumber(usage.output);
    const cacheRead = toNumber(usage.cacheReadInput ?? usage.cachedInput);
    const cacheCreation = toNumber(usage.cacheCreationInput);
    const estimatedUsd = (
      (input * price.input)
      + (output * price.output)
      + (cacheRead * price.cacheRead)
      + (cacheCreation * price.cacheCreation)
    ) / 1_000_000;

    return {
      estimatedUsd,
      known: true,
      knownTokenTotal: input + output + cacheRead + cacheCreation,
      pricingSource: price.source,
      speed: price.speed,
    };
  }

  function estimateCostSummary(events, options = {}) {
    let estimatedUsd = 0;
    let knownTokenTotal = 0;
    const unknownModels = new Set();
    const byModel = new Map();

    for (const event of events || []) {
      if (!event?.tokenUsage) continue;
      const model = event.model || "unknown";
      const costOptions = typeof options.resolveOptions === "function" ? options.resolveOptions(event) : options;
      const estimate = estimateTokenCost(event.tokenUsage, model, costOptions);
      if (!estimate.known) {
        unknownModels.add(model);
        continue;
      }

      estimatedUsd += estimate.estimatedUsd;
      knownTokenTotal += estimate.knownTokenTotal;
      const row = byModel.get(model) || { model, estimatedUsd: 0, knownTokenTotal: 0 };
      row.estimatedUsd += estimate.estimatedUsd;
      row.knownTokenTotal += estimate.knownTokenTotal;
      byModel.set(model, row);
    }

    return {
      estimatedUsd,
      knownTokenTotal,
      currency: "USD",
      source: "built-in-estimate",
      unknownModels: [...unknownModels].sort(),
      byModel: [...byModel.values()].sort((left, right) => right.estimatedUsd - left.estimatedUsd),
    };
  }

  return {
    PRICING_VERSION,
    estimateCostSummary,
    estimateTokenCost,
    findModelPrice,
    normalizeSpeedTier,
  };
});
