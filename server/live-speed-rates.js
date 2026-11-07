const { estimateResponseCost } = require("./performance-facts");

// Rate estimates use the very same timed responses as the output estimate.
// Only the cost denominator omits rows without a price.
function createResponseRates() {
  const prices = new Map();
  return function responseRates(rows) {
    if (!rows.length) return null;
    let seconds = 0, output = 0, input = 0, reasoning = 0, reasoningOutput = 0;
    let dollars = 0, pricedSeconds = 0;
    for (const row of rows) {
      const duration = row.durationMs / 1000;
      seconds += duration;
      output += row.output;
      input += row.input || 0;
      if (row.reasoning != null) {
        reasoning += Math.min(row.reasoning, row.output);
        reasoningOutput += row.output;
      }
      if (!prices.has(row)) {
        const estimate = estimateResponseCost(row);
        prices.set(row, estimate.known && Number.isFinite(estimate.estimatedUsd) ? estimate.estimatedUsd : null);
      }
      const price = prices.get(row);
      if (price != null) {
        dollars += price;
        pricedSeconds += duration;
      }
    }
    const cost = pricedSeconds > 0 ? dollars / pricedSeconds : null;
    return {
      output: output / seconds,
      total: (input + output) / seconds,
      reasoning: output > 0 && reasoningOutput === 0 ? null : reasoning / seconds,
      reasoningCoverage: output > 0 ? reasoningOutput / output : 1,
      cost: Number.isFinite(cost) ? cost : null,
    };
  };
}

function emptyRates() {
  const optional = () => ({ measured: 0, estimated: 0, coveredOutput: 0, observed: false, partial: false });
  return { measured: 0, estimated: 0, rates: {
    total: { measured: 0, estimated: 0 }, reasoning: optional(), cost: optional(),
  } };
}

function addOptional(target, value, activity, coverage, output, fraction, field) {
  if (value != null) {
    target[field] += value * fraction;
    target.observed ||= activity || value > 0;
  }
  target.coveredOutput += output * coverage;
  target.partial ||= activity && coverage < 1;
}

function addRates(target, values, fraction, field) {
  const output = values.output * fraction;
  target[field] += output;
  target.rates.total[field] += values.total * fraction;
  addOptional(target.rates.reasoning, values.reasoning, values.output > 0, values.reasoningCoverage, output, fraction, field);
  addOptional(target.rates.cost, values.cost, values.total > 0, values.cost == null ? 0 : 1, output, fraction, field);
}

function publicRates({ measured, estimated, rates }, includeCoverage = true) {
  const output = measured + estimated;
  function optional(row) {
    const value = { measured: row.measured, estimated: row.estimated, available: row.observed || !row.partial };
    if (includeCoverage) {
      value.partial = row.partial;
      value.knownShare = output > 0 ? Math.min(1, row.coveredOutput / output) : 1;
    }
    return value;
  }
  return { measured, estimated, rates: { total: rates.total, reasoning: optional(rates.reasoning), cost: optional(rates.cost) } };
}

module.exports = { createResponseRates, emptyRates, addRates, publicRates };
