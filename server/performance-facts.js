const { estimateTokenCost } = require("../shared/token-pricing");
const { qwenToolEvents, qwenUsage } = require("../shared/qwen-code");
const { dshToolEvents, dshUsage } = require("../shared/dsh");
const { codexToolExitCode } = require("../shared/observer-core");

const token = (value) => Math.min(1e12, Math.max(0, Math.trunc(Number(value) || 0)));
function usageFor(obj, source, cumulative = false) {
  if (source === "qwen") {
    const usage = qwenUsage(obj);
    return { input: usage?.input, cachedInput: usage?.cachedInput, reasoning: usage?.reasoning };
  }
  if (source === "dsh") {
    const usage = dshUsage(obj);
    return { input: usage?.inputTotal, cachedInput: usage?.cachedInput, cacheCreation: usage?.cacheCreation };
  }
  const p = obj.payload || {};
  const usage = source === "claude" ? obj.message?.usage || {} : obj.type === "token_usage_record" ? p.usage || {}
    : p.info?.[cumulative ? "total_token_usage" : "last_token_usage"] || {};
  const cachedInput = token(source === "claude" ? usage.cache_read_input_tokens : usage.cached_input_tokens ?? usage.input_tokens_details?.cached_tokens);
  const cacheCreation = source === "claude" ? token(usage.cache_creation_input_tokens) : 0;
  const reasoning = source === "claude" ? usage.output_tokens_details?.thinking_tokens
    : usage.reasoning_output_tokens ?? usage.output_tokens_details?.reasoning_tokens;
  return { input: token(token(usage.input_tokens) + (source === "claude" ? cachedInput + cacheCreation : 0)), cachedInput, cacheCreation,
    reasoning: Number.isFinite(reasoning) ? token(reasoning) : null };
}

function estimateResponseCost(response) {
  if (["qwen", "dsh"].includes(response.sourceType) && (response.input == null || response.output == null)) {
    return { known: false, estimatedUsd: 0 };
  }
  const { input = 0, cachedInput = 0, cacheCreation = 0, output = 0 } = response;
  return estimateTokenCost({
    input: Math.max(0, input - cachedInput - cacheCreation),
    cacheReadInput: cachedInput,
    cacheCreationInput: cacheCreation,
    output,
  }, response.model, {
    time: new Date(response.endMs).toISOString(),
    speed: response.modes?.tier?.value,
    recordedUsd: response.recordedUsd,
  });
}
function toolEvents(obj, source) {
  if (source === "qwen") return qwenToolEvents(obj);
  if (source === "dsh") return dshToolEvents(obj);
  const p = obj.payload || {};
  if (source === "codex" && obj.type === "response_item") {
    if (["function_call", "custom_tool_call"].includes(p.type)) return [{ kind: "call", id: p.call_id, tool: p.name, args: p.arguments ?? p.input }];
    if (["function_call_output", "custom_tool_call_output"].includes(p.type)) {
      const code = codexToolExitCode(p);
      const failed = Number.isInteger(code) ? code !== 0 : typeof p.is_error === "boolean" ? p.is_error : null;
      return [{ kind: "result", id: p.call_id, failed }];
    }
  }
  if (source === "claude" && obj.message?.model !== "<synthetic>" && Array.isArray(obj.message?.content)) {
    return obj.message.content.flatMap((part) => obj.type === "assistant" && part.type === "tool_use"
      ? [{ kind: "call", id: part.id, tool: part.name, args: part.input }] : obj.type === "user" && part.type === "tool_result"
        ? [{ kind: "result", id: part.tool_use_id, failed: part.is_error === true }] : []);
  }
  return [];
}
module.exports = { usageFor, estimateResponseCost, toolEvents };
