function scalarContent(value) {
  if (typeof value === "string") return value;
  if (Array.isArray(value)) return value.map((item) => scalarContent(item?.text ?? item?.content ?? item)).filter(Boolean).join("\n");
  if (value && typeof value === "object") return value.text || value.content || JSON.stringify(value);
  return value == null ? "" : String(value);
}

function parseGenericLineToEvent(obj, context = {}) {
  if (!obj || typeof obj !== "object") return [];
  const message = obj.message && typeof obj.message === "object" ? obj.message : obj;
  const role = String(message.role || obj.role || obj.type || "").toLowerCase();
  const content = scalarContent(message.content ?? message.text ?? obj.content ?? obj.text ?? obj.output);
  const sessionId = obj.sessionId || obj.session_id || obj.conversationId || obj.conversation_id || context.sessionId || "unknown";
  const time = obj.time || obj.timestamp || obj.created_at || obj.createdAt || "";
  const model = obj.model || message.model || context.model || "unknown";
  const cwd = obj.cwd || obj.working_directory || obj.project_path || context.cwd || "";
  const sourceType = context.sourceType || obj.sourceType || "custom";
  const toolName = obj.toolName || obj.tool_name || message.toolName || message.name || "";
  let callType = "Agent";
  if (role === "user" || role === "human" || role === "prompt") callType = "Prompt";
  else if (role.includes("tool") && /result|output|response/.test(role)) callType = "Tool_Result";
  else if (role.includes("tool") || obj.tool_call || obj.tool_calls) callType = "Tool_Call";
  else if (role === "system") callType = "System";
  const usage = obj.usage || message.usage || obj.tokenUsage;
  const events = [{
    sessionId,
    time,
    model,
    cwd,
    sourceType,
    sourceFile: context.sourceFile,
    callType,
    toolName,
    content,
  }];
  if (usage && typeof usage === "object") {
    events.push({
      sessionId,
      time,
      model,
      cwd,
      sourceType,
      sourceFile: context.sourceFile,
      callType: "Token_Usage",
      tokenUsage: {
        input: Number(usage.input ?? usage.input_tokens ?? usage.prompt_tokens) || 0,
        output: Number(usage.output ?? usage.output_tokens ?? usage.completion_tokens) || 0,
        cacheReadInput: Number(usage.cacheReadInput ?? usage.cache_read_input_tokens ?? usage.cached_tokens) || 0,
        cacheCreationInput: Number(usage.cacheCreationInput ?? usage.cache_creation_input_tokens) || 0,
        reasoningOutput: Number(usage.reasoningOutput ?? usage.reasoning_tokens) || 0,
        total: Number(usage.total ?? usage.total_tokens) || 0,
      },
    });
  }
  return events.filter((event) => event.callType === "Token_Usage" || event.content || event.toolName);
}

module.exports = { parseGenericLineToEvent };
