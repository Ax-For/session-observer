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

  const MODEL_PRICE_HINTS = [
    { match: /claude.*haiku/i, input: 0.8, output: 4, cacheRead: 0.08, cacheCreation: 1 },
    { match: /claude.*sonnet/i, input: 3, output: 15, cacheRead: 0.3, cacheCreation: 3.75 },
    { match: /claude.*opus/i, input: 15, output: 75, cacheRead: 1.5, cacheCreation: 18.75 },
    { match: /gpt-4\.1|gpt-4o/i, input: 2.5, output: 10, cacheRead: 0.25, cacheCreation: 2.5 },
    { match: /gpt-5/i, input: 1.25, output: 10, cacheRead: 0.125, cacheCreation: 1.25 },
    { match: /qwen/i, input: 0.4, output: 1.2, cacheRead: 0.04, cacheCreation: 0.4 },
    { match: /deepseek/i, input: 0.27, output: 1.1, cacheRead: 0.027, cacheCreation: 0.27 },
    { match: /glm/i, input: 0.5, output: 1.5, cacheRead: 0.05, cacheCreation: 0.5 },
  ];

  function toNumber(value) {
    const num = Number(value);
    return Number.isFinite(num) ? num : 0;
  }

  function findModelPrice(model) {
    const text = String(model || "");
    const entry = MODEL_PRICE_HINTS.find((item) => item.match.test(text));
    if (!entry) return null;
    return {
      input: entry.input,
      output: entry.output,
      cacheRead: entry.cacheRead,
      cacheCreation: entry.cacheCreation,
    };
  }

  function estimateTokenCost(tokenUsage, model) {
    const price = findModelPrice(model);
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
    };
  }

  function estimateCostSummary(events) {
    let estimatedUsd = 0;
    let knownTokenTotal = 0;
    const unknownModels = new Set();
    const byModel = new Map();

    for (const event of events || []) {
      if (!event?.tokenUsage) continue;
      const model = event.model || "unknown";
      const estimate = estimateTokenCost(event.tokenUsage, model);
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
    estimateCostSummary,
    estimateTokenCost,
    findModelPrice,
  };
});
