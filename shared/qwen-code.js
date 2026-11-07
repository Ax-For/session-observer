(function initQwenCode(scope, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  if (scope) scope.ObserverQwenCode = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function createQwenCode() {
  "use strict";

  const token = (value) => typeof value === "number" && Number.isFinite(value) && value >= 0
    ? Math.min(1e12, Math.floor(value)) : null;
  const id = (value) => typeof value === "string" ? value.slice(0, 240) : "";
  const parts = (obj) => Array.isArray(obj.message?.parts) ? obj.message.parts : [];
  const text = (value) => typeof value === "string" ? value : value == null ? "" : JSON.stringify(value);

  function qwenUsage(obj) {
    if (obj.type !== "assistant") return null;
    const usage = obj.usageMetadata;
    const input = token(usage?.promptTokenCount);
    const candidates = token(usage?.candidatesTokenCount);
    const total = token(usage?.totalTokenCount);
    const thoughts = token(usage?.thoughtsTokenCount);
    if (input == null || candidates == null) {
      return total == null ? null : { input: null, cachedInput: null, output: null, reasoning: null, total };
    }
    // Qwen's OpenAI converter includes thinking in candidates. Providers that
    // report it separately include it in total, so only add it in that case.
    const separateThoughts = thoughts != null && total === input + candidates + thoughts;
    const output = separateThoughts ? Math.min(1e12, candidates + thoughts) : candidates;
    return {
      input, output, total: input + output,
      cachedInput: Math.min(input, token(usage?.cachedContentTokenCount) ?? 0),
      reasoning: thoughts == null ? null : Math.min(output, thoughts),
    };
  }

  function qwenToolEvents(obj) {
    return parts(obj).flatMap((part) => {
      const call = obj.type === "assistant" && part?.functionCall;
      if (call && id(call.id) && id(call.name)) {
        return [{ kind: "call", id: id(call.id), tool: id(call.name), args: call.args }];
      }
      const result = obj.type === "tool_result" && part?.functionResponse;
      if (result && id(result.id)) {
        return [{ kind: "result", id: id(result.id), tool: id(result.name),
          failed: result.response?.error != null, response: result.response }];
      }
      return [];
    });
  }

  function qwenSignal(obj, context, usage = qwenUsage(obj)) {
    const time = Date.parse(obj.timestamp);
    if (!Number.isFinite(time) || !id(obj.sessionId)) return null;
    if (obj.type === "user" || obj.type === "tool_result") {
      context.qwenTiming = null;
      return { kind: "start" };
    }
    if (obj.type === "system" && obj.subtype === "turn_result") return { kind: "end" };
    if (obj.type === "system" && obj.subtype === "ui_telemetry") {
      const event = obj.systemPayload?.uiEvent;
      if (event?.["event.name"] === "qwen-code.api_response" && event.status_code >= 200 && event.status_code < 300) {
        context.qwenTiming = { uuid: id(obj.uuid), time, duration: event.duration_ms, sessionId: obj.sessionId };
      } else if (event?.["event.name"] === "request_lifecycle" && event.v === 1 && event.kind === "request"
        && event.sessionId === obj.sessionId && !event.subagentId) {
        if (event.phase === "started") {
          context.qwenTiming = null;
          const startMs = Number.isFinite(event.startedAt) && event.startedAt <= time && event.startedAt >= time - 5000
            ? event.startedAt : time;
          return { kind: "start", explicit: true, startMs, model: id(event.model) };
        }
        if (event.phase === "ended") {
          if (event.outcome !== "success") {
            context.qwenTiming = null;
            return { kind: "end", failed: event.outcome === "error" };
          }
          context.qwenTiming = { uuid: id(obj.uuid), time, duration: event.durationMs,
            sessionId: obj.sessionId, promptId: id(event.promptId), model: id(event.model) };
        }
      } else if (event?.["event.name"] === "qwen-code.api_error") {
        context.qwenTiming = null;
        return { kind: "end", failed: true };
      }
      return null;
    }
    if (obj.type !== "assistant") return null;
    const timing = context.qwenTiming;
    context.qwenTiming = null;
    const linked = timing && ((timing.uuid && timing.uuid === obj.parentUuid)
      || (timing.promptId && timing.promptId === obj.promptId && timing.model === obj.model));
    const duration = linked && timing.sessionId === obj.sessionId && time - timing.time >= 0 && time - timing.time <= 5000
      && Number.isFinite(timing.duration) && timing.duration >= 0 && timing.duration <= 900_000 ? timing.duration : null;
    return {
      kind: "snapshot", responseId: id(obj.uuid), output: usage?.output ?? null, final: true,
      startMs: duration == null ? undefined : time - duration,
      phase: parts(obj).some((part) => part?.functionCall) ? "tools" : "idle",
    };
  }

  function parseQwenCodeLineToEvent(obj, context = {}) {
    if (!obj || !id(obj.sessionId) || !Number.isFinite(Date.parse(obj.timestamp))) return [];
    const usage = qwenUsage(obj);
    const signal = qwenSignal(obj, context, usage);
    const sessionId = id(obj.sessionId);
    context.sessionId = sessionId;
    if (id(obj.model) || signal?.model) context.model = id(obj.model) || signal.model;
    if (typeof obj.cwd === "string") context.cwd = obj.cwd;
    const base = {
      time: obj.timestamp, sessionId, model: context.model || "unknown", cwd: context.cwd || "",
      turnId: id(obj.promptId) || id(obj.uuid), sourceFile: context.sourceFile,
      sourceType: "qwen", rawType: obj.type, rawSubType: obj.subtype || "",
    };
    const events = [];
    function add(callType, content, extra) {
      const limit = context.compactContent ? context.contentLimit || 1000 : Infinity;
      events.push({ ...base, callType, content: content.slice(0, limit), summary: content.slice(0, 220), ...extra });
    }
    const content = (thinking) => parts(obj).filter((part) => typeof part?.text === "string" && Boolean(part.thought) === thinking)
      .map((part) => part.text).join("\n");
    if (obj.type === "user") {
      add("Prompt", content(false) || "(无文本输入)");
    } else if (obj.type === "assistant" || obj.type === "tool_result") {
      const thinking = content(true);
      const answer = content(false);
      if (thinking) add("Thinking", thinking);
      if (answer && obj.type === "assistant") add("Agent", answer);
      for (const tool of qwenToolEvents(obj)) {
        const meta = { toolName: tool.tool, callId: tool.id };
        if (tool.kind === "call") add("Tool_Call", `tool=${tool.tool}\nargs=${text(tool.args)}`, meta);
        else add("Tool_Result", text(tool.response?.error ?? tool.response?.output ?? tool.response), { ...meta, isError: tool.failed });
      }
      if (usage) {
        const { input, output, cachedInput, reasoning, total } = usage;
        add("Token_Usage", `total=${total}`, { tokenUsage: {
          input: input == null ? null : input - cachedInput, output, total,
          cachedInput, cacheReadInput: cachedInput, reasoningOutput: reasoning,
        } });
      }
    } else if (obj.subtype === "chat_compression") {
      add("Compaction", "上下文已压缩");
    }
    if (signal && !events.length) {
      add(signal.failed ? "Error" : "Raw", signal.failed ? "Qwen Code 模型请求失败"
        : signal.kind === "start" ? "Qwen Code 模型请求开始" : signal.kind === "snapshot" ? "Qwen Code 响应完成" : "Qwen Code 请求结束");
    }
    if (signal && events.length) events[0].performanceSignal = signal;
    return events;
  }

  return { parseQwenCodeLineToEvent, qwenUsage, qwenToolEvents, qwenSignal };
});
