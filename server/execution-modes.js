const { readSmallFile } = require("./source-locations");

const efforts = new Set(["off", "minimal", "low", "medium", "high", "xhigh", "max"]);
const openAiTiers = new Map([["default", "standard"], ["standard", "standard"], ["priority", "fast"], ["fast", "fast"], ["ultrafast", "ultrafast"]]);
const fact = (value, evidence) => value ? { value, evidence } : undefined;
const effort = (value, evidence) => fact(efforts.has(value) ? value : undefined, evidence);
const codexTier = (value, evidence) => fact(openAiTiers.get(value), evidence);
const present = (values) => Object.fromEntries(Object.entries(values).filter(([, value]) => value != null));

function configuredCodexTier(text) {
  const topLevel = String(text).split(/^\s*\[/m, 1)[0];
  const declarations = topLevel.split(/\r?\n/).filter((line) => /^\s*service_tier\s*=/.test(line));
  if (declarations.length !== 1) return null;
  const match = /^\s*service_tier\s*=\s*(["'])([a-z]+)\1\s*(?:#.*)?$/.exec(declarations[0]);
  // An ambiguous multiline string may contain a line that looks like a key.
  if (!match || /"""|'''/.test(topLevel)) return null;
  return codexTier(match[2], "configured") || null;
}

function readConfiguredTier(file) {
  if (!file) return null;
  try { return configuredCodexTier(readSmallFile(file)); } catch { return null; }
}

function executionModes(obj, context, source, configured) {
  const payload = obj.payload || {};
  if (source === "codex") {
    const session = context.sessionModes ||= {};
    if (obj.type === "event_msg" && payload.type === "thread_settings_applied") {
      const settings = payload.thread_settings || {};
      if (Object.hasOwn(settings, "service_tier")) session.tier = codexTier(settings.service_tier, "selected");
      if (Object.hasOwn(settings, "reasoning_effort")) session.effort = effort(settings.reasoning_effort, "selected");
    }
    if (obj.type === "turn_context") context.turnModes = present({
      tier: codexTier(payload.service_tier, "selected"),
      effort: effort(payload.effort ?? payload.collaboration_mode?.settings?.reasoning_effort, "recorded"),
    });
    const known = present({ ...session, ...context.turnModes });
    const recorded = obj.type === "token_usage_record" ? codexTier(payload.service_tier, "recorded") : undefined;
    return { current: present({ ...known, tier: known.tier || configured }), response: recorded ? { ...known, tier: recorded } : known };
  }
  if (source !== "claude") return { current: {}, response: {} };
  const attachment = obj.type === "attachment" ? obj.attachment?.type : "";
  if (attachment === "ultra_effort_enter") context.ultraSession = true;
  if (attachment === "ultra_effort_exit") context.ultraSession = false;
  if (attachment === "workflow_keyword_request") context.ultraTurn = true;
  const content = obj.message?.content;
  if (obj.type === "user" && obj.isMeta !== true && (typeof content === "string" || Array.isArray(content) && content.some((part) => part?.type === "text"))) context.ultraTurn = false;
  const ultra = context.ultraSession || context.ultraTurn;
  let response = {};
  if (obj.type === "assistant" && obj.message?.model !== "<synthetic>") {
    const speed = obj.message?.usage?.speed;
    const tier = fact(speed === "fast" || speed === "standard" ? speed : undefined, "served");
    const previous = obj.message?.id && obj.message.id === context.lastModeMessage ? context.lastModes : null;
    response = present({ tier: tier || previous?.tier,
      effort: ultra ? fact("ultracode", "recorded") : effort(obj.perTurnEffort ?? obj.effort, "recorded") || previous?.effort });
    context.lastModeMessage = obj.message?.id;
    context.lastModes = response;
  }
  const current = { ...context.lastModes };
  if (ultra) current.effort = fact("ultracode", "recorded");
  else if (current.effort?.value === "ultracode") delete current.effort;
  return { current, response };
}

module.exports = { executionModes, configuredCodexTier, readConfiguredTier };
