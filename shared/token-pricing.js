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

  const PRICING_VERSION = "2026-09-12.v2";
  let customRates = [];

  const MODEL_PRICE_HINTS = [
    { match: /^gpt-5\.5(?:-\d{4}-\d{2}-\d{2})?$/i, input: 5, output: 30, cacheRead: 0.5, cacheCreation: 5, fastMultiplier: 2.5, source: "codex-rate-card" },
    { match: /^gpt-5\.4-mini(?:-\d{4}-\d{2}-\d{2})?$/i, input: 0.75, output: 4.52, cacheRead: 0.075, cacheCreation: 0.75, source: "codex-rate-card" },
    { match: /^gpt-5\.4(?:-\d{4}-\d{2}-\d{2})?$/i, input: 2.5, output: 15, cacheRead: 0.25, cacheCreation: 2.5, fastMultiplier: 2, source: "codex-rate-card" },
    { match: /^gpt-5\.3-codex(?:-spark)?(?:-\d{4}-\d{2}-\d{2})?$/i, input: 1.75, output: 14, cacheRead: 0.175, cacheCreation: 1.75, fastMultiplier: 2, source: "codex-estimate" },
    { match: /^claude-haiku-4-5(?:-\d{8})?$/i, input: 1, output: 5, cacheRead: 0.1, cacheCreation: 1.25 },
    { match: /^claude-3-5-haiku(?:-\d{8})?$/i, input: 0.8, output: 4, cacheRead: 0.08, cacheCreation: 1 },
    { match: /^claude-sonnet-4(?:-[56])?(?:-\d{8})?$/i, input: 3, output: 15, cacheRead: 0.3, cacheCreation: 3.75 },
    { match: /^claude-opus-4-[567](?:-\d{8})?$/i, input: 5, output: 25, cacheRead: 0.5, cacheCreation: 6.25 },
    { match: /^claude-opus-4(?:-1)?(?:-\d{8})?$/i, input: 15, output: 75, cacheRead: 1.5, cacheCreation: 18.75 },
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
    const instant = Date.parse(options.time || "");
    const custom = customRates.filter((item) => item.model === text && (!item.from || instant >= Date.parse(item.from))
      && (!item.until || instant < Date.parse(item.until)) && (!item.serviceTier || item.serviceTier === normalizeSpeedTier(options.speed)))
      .sort((a, b) => (Date.parse(b.from) || 0) - (Date.parse(a.from) || 0))[0];
    const entry = custom || MODEL_PRICE_HINTS.find((item) => item.match.test(text));
    if (!entry) return null;
    const price = custom ? { ...applySpeedTier(entry), speed: normalizeSpeedTier(options.speed) } : applySpeedTier(entry, options);
    return { ...price, version: PRICING_VERSION, effectiveFrom: custom?.from || "", effectiveUntil: custom?.until || "",
      source: custom ? "local-pricebook" : "dated-reference-estimate",
      reference: custom?.reference || (text.startsWith("claude") ? "https://platform.claude.com/docs/en/about-claude/pricing" : "https://developers.openai.com/api/docs/pricing"),
      historicalRateVerified: Boolean(custom), tierSource: options.tierSource || "assumed" };
  }

  function configureRates(rates = []) {
    if (!Array.isArray(rates) || rates.length > 500) throw new Error("Pricebook must contain at most 500 rates");
    for (const rate of rates) {
      if (!rate.model || typeof rate.model !== "string" || rate.model.length > 160) throw new Error("Exact model name required");
      for (const key of ["input", "output", "cacheRead", "cacheCreation"]) {
        if (typeof rate[key] !== "number" || !Number.isFinite(rate[key]) || rate[key] < 0) throw new Error("Nonnegative USD prices per million tokens required");
      }
      for (const key of ["from", "until"]) if (rate[key] && !Number.isFinite(Date.parse(rate[key]))) throw new Error("Invalid price effective date");
      if (rate.from && rate.until && Date.parse(rate.from) >= Date.parse(rate.until)) throw new Error("Price interval must have positive duration");
    }
    customRates = rates.map((rate) => ({ ...rate }));
    return customRates;
  }

  function estimateTokenCost(tokenUsage, model, options = {}) {
    const price = findModelPrice(model, options);
    const usage = tokenUsage || {};
    const recorded = typeof options.recordedUsd === "number" && Number.isFinite(options.recordedUsd);
    if (recorded) return { estimatedUsd: options.recordedUsd, known: true,
      knownTokenTotal: toNumber(usage.input) + toNumber(usage.output) + toNumber(usage.cacheReadInput ?? usage.cachedInput) + toNumber(usage.cacheCreationInput),
      pricingSource: "recorded-message-usd", pricingVersion: PRICING_VERSION };
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
      pricingVersion: price.version,
      reference: price.reference,
      historicalRateVerified: price.historicalRateVerified,
      tierSource: price.tierSource,
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
    configureRates,
    estimateCostSummary,
    estimateTokenCost,
    findModelPrice,
    normalizeSpeedTier,
  };
});
