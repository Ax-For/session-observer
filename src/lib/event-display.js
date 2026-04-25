import { clipText } from "./formatters";

export function eventTone(callType) {
  const type = String(callType || "").toLowerCase();
  if (type.includes("tool_call")) return "call";
  if (type.includes("tool_result")) return "result";
  if (type.includes("token")) return "token";
  if (type.includes("agent")) return "agent";
  if (type.includes("prompt") || type.includes("user")) return "user";
  return "neutral";
}

export function eventDialogueRole(callType) {
  const type = String(callType || "").toLowerCase();
  if (type.includes("agent")) return "agent";
  if (type.includes("prompt") || type.includes("user")) return "user";
  return "";
}

export function readableEventSummary(event, limit = 160) {
  const summary = String(event?.summary || event?.content || "").trim();
  const callType = String(event?.callType || "").toLowerCase();

  if (callType.includes("token")) return summary || "Token usage";

  const toolMatch = summary.match(/tool=([^\s]+)/i) || String(event?.extra || "").match(/tool=([^\s]+)/i);
  const argsMatch = summary.match(/args=(.+)$/i);
  if (toolMatch) {
    const args = argsMatch ? clipText(argsMatch[1], Math.max(40, limit - 48)) : "";
    return args ? `调用 ${toolMatch[1]} · ${args}` : `调用 ${toolMatch[1]}`;
  }

  if (callType.includes("tool_result")) {
    const output = readableToolOutput(summary);
    return output ? `工具返回 · ${clipText(output, limit)}` : "工具返回";
  }

  if (callType.includes("agent")) return withDialoguePrefix(summary, "助手输出", limit);
  if (callType.includes("prompt") || callType.includes("user")) return withDialoguePrefix(summary, "用户输入", limit);

  return clipText(summary, limit) || "-";
}

export function readableDialogueContent(event, limit = 180) {
  const summary = readableEventSummary(event, limit);
  return summary.replace(/^(?:(用户输入|助手输出) ·\s*)+/, "");
}

function readableToolOutput(summary) {
  const textMatch = summary.match(/"text":"((?:\\.|[^"])*)"/);
  const readableOutput = textMatch?.[1]
    ? textMatch[1].replace(/\\n/g, " ").replace(/\\"/g, "\"")
    : summary;

  return readableOutput.replace(/^Wall time:\s*/i, "耗时 ").replace(/\s+/g, " ").trim();
}

function withDialoguePrefix(summary, prefix, limit) {
  if (!summary) return prefix;
  const clipped = clipText(summary, limit);
  return clipped.startsWith(`${prefix} ·`) ? clipped : `${prefix} · ${clipped}`;
}
