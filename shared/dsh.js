(function initDsh(scope, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  if (scope) scope.ObserverDsh = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function createDsh() {
  "use strict";

  const id = (value) => typeof value === "string" ? value.slice(0, 240) : "";
  const tokens = (value) => Number.isFinite(value) && value >= 0 ? Math.min(1e12, Math.floor(value)) : null;
  const timestamp = (value) => Number.isFinite(value) && value > 0 && value <= 8.64e15;
  const isToolBlock = (part) => part?.type === "tool-call";

  function* dshRecords(obj) {
    if (!obj || typeof obj !== "object") return;
    if (obj.type !== "snapshot") {
      if (obj.type === "event") yield { record: obj.event, path: ["event"] };
      else yield { record: obj, path: [] };
      return;
    }
    yield { record: obj.header, path: ["header"] };
    if (!Array.isArray(obj.records)) return;
    for (const [index, item] of obj.records.entries()) {
      if (item?.type === "event") yield { record: item.event, path: ["records", index, "event"] };
      else yield { record: item, path: ["records", index] };
    }
  }

  function prepareDshRecord(record, context) {
    if (!record || typeof record !== "object") return false;
    if (record.type === "session") {
      if (!context.dshHeader && id(record.id)) {
        context.dshHeader = true;
        context.sessionId = id(record.id);
        context.dshCreatedAt = timestamp(record.createdAt) ? record.createdAt : null;
        context.cwd = typeof record.cwd === "string" ? record.cwd : "";
        context.parentSessionId = id(record.parentSession);
        context.isSubagent = record.origin === "subagent" || record.delegationDepth > 0 || Boolean(context.parentSessionId);
      }
      return false;
    }
    if (!context.sessionId || context.sessionId === "unknown" || !timestamp(record.time)
      || (context.dshCreatedAt != null && record.time < context.dshCreatedAt - 2000)) return false;
    if (Number.isSafeInteger(record.seq)) {
      if (record.seq <= (context.dshSequence ?? -1)) return false;
      context.dshSequence = record.seq;
    }
    const data = record.data || {};
    if (record.type === "session/title" && typeof data.title === "string") context.sessionTitle = data.title.trim().slice(0, 240);
    const model = id(data.message?.source?.model) || id(data.header?.config?.model);
    if (model) context.model = model;
    if (record.type === "turn/start" || record.type === "step/start") {
      if (typeof data.turn === "number" || typeof data.turn === "string") context.turnId = String(data.turn);
    }
    return true;
  }

  function dshUsage(record) {
    if (record.type !== "assistant/message" || !record.data?.usage) return null;
    const usage = record.data.usage;
    const input = tokens(usage.inputTokens);
    const output = tokens(usage.outputTokens);
    const cachedInput = tokens(usage.cacheReadTokens) ?? 0;
    const cacheCreation = tokens(usage.cacheWriteTokens) ?? 0;
    const inputTotal = input == null ? null : input + cachedInput + cacheCreation;
    const total = inputTotal != null && output != null ? inputTotal + output : tokens(usage.totalTokens);
    return { input, output, cachedInput, cacheCreation, inputTotal, total };
  }

  function dshSignal(record, context) {
    if (record.type === "step/start") return { kind: "start", explicit: true, model: context.model };
    if (record.type === "turn/end") return { kind: "end" };
    if (record.type !== "assistant/message") return null;
    const message = record.data?.message;
    const phase = Array.isArray(message?.content) && message.content.some(isToolBlock) ? "tools" : "idle";
    const usage = dshUsage(record);
    if (!usage) return { kind: "end", phase };
    return { kind: "snapshot", responseId: id(message?.id) || `dsh:${context.sessionId}:${record.seq ?? record.time}`,
      output: usage.output, final: true, phase, model: context.model };
  }

  function dshToolEvents(record) {
    const data = record.data || {};
    if (record.type === "tool/call" && id(data.callId) && id(data.name)) {
      return [{ kind: "call", id: id(data.callId), tool: id(data.name), args: data.arguments }];
    }
    const result = data.message;
    if (record.type === "tool/result" && id(result?.toolCallId)) {
      return [{ kind: "result", id: id(result.toolCallId), failed: typeof result.isError === "boolean" ? result.isError : null }];
    }
    return [];
  }

  function blockText(content, type = "text") {
    if (typeof content === "string") return type === "text" ? content : "";
    return Array.isArray(content) ? content.filter((part) => part?.type === type && typeof part.text === "string").map((part) => part.text).join("\n") : "";
  }

  function parseDshLineToEvent(obj, context = {}) {
    const events = [];
    for (const { record, path } of dshRecords(obj)) {
      if (!prepareDshRecord(record, context)) continue;
      const data = record.data || {};
      const turn = data.turn ?? context.turnId;
      const base = { time: new Date(record.time).toISOString(), sessionId: context.sessionId, parentSessionId: context.parentSessionId,
        isSubagent: context.isSubagent, cwd: context.cwd, sessionTitle: context.sessionTitle, model: context.model || "unknown",
        turnId: turn == null ? "" : String(turn), sourceFile: context.sourceFile, sourceType: "dsh", rawType: record.type };
      const first = events.length;
      function add(callType, content, fields) {
        const limit = context.compactContent ? context.contentLimit || 1000 : Infinity;
        events.push({ ...base, callType, content: content.slice(0, limit), summary: content.slice(0, 220), ...fields });
      }
      if (record.type === "user/message") {
        add("Prompt", blockText(data.content) || "(无文本输入)", { dshDialoguePath: [...path, "data", "content"] });
      } else if (record.type === "assistant/message") {
        const content = data.message?.content;
        const thought = blockText(content, "reasoning"), text = blockText(content);
        if (thought) add("Thinking", thought);
        if (text) add("Agent", text, { dshDialoguePath: [...path, "data", "message", "content"] });
        const usage = dshUsage(record);
        if (usage) add("Token_Usage", `total=${usage.total ?? "unknown"}`, { tokenUsage: {
          input: usage.input, output: usage.output, total: usage.total, cachedInput: usage.cachedInput,
          cacheReadInput: usage.cachedInput, cacheCreationInput: usage.cacheCreation,
        } });
      } else if (record.type === "session/title" && context.sessionTitle) {
        add("Raw", context.sessionTitle);
      }
      for (const tool of dshToolEvents(record)) {
        if (tool.kind === "call") {
          const args = typeof tool.args === "string" ? tool.args : JSON.stringify(tool.args ?? {});
          add("Tool_Call", `tool=${tool.tool}\nargs=${args}`, { toolName: tool.tool, callId: tool.id });
        } else add("Tool_Result", blockText(data.message?.content) || "工具返回", { callId: tool.id, isError: tool.failed === true });
      }
      const signal = dshSignal(record, context);
      if (signal && events.length === first) add("Raw", signal.kind === "start" ? "DeepSeek Harness 模型请求开始" : "DeepSeek Harness 响应结束");
      if (signal) events[first].performanceSignal = signal;
    }
    return events;
  }

  return { dshRecords, prepareDshRecord, dshSignal, dshToolEvents, dshUsage, parseDshLineToEvent };
});
