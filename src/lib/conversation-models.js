const INTERNAL_CONTENT_MARKERS = [
  "[subagent:",
  "<command-name>",
  "<command-message>",
  "<command-args>",
  "<local-command-stdout>",
  "<system-reminder>",
  "<task-notification>",
  "<local-command-caveat>",
  "<environment_context>",
  "Caveat:",
  "This session is being continued from a previous",
  "[Request interrupted",
];

const CONTEXT_BLOCK_PATTERN = /<environment_context>[\s\S]*?<\/environment_context>/gi;
const MARKDOWN_PATTERNS = [
  /(^|\n)#{1,6}\s+\S/m,
  /(^|\n)\s*([-*+]\s+|\d+\.\s+)\S/m,
  /(^|\n)\s*>\s+\S/m,
  /```[\s\S]*?```/,
  /\[[^\]]+\]\([^)]+\)/,
  /(\*\*[^*]+\*\*|__[^_]+__|`[^`\n]+`)/,
  /(^|\n)\|.+\|/,
];
const TOOL_RESULT_ERROR_PATTERNS = [
  /\bProcess exited with code\s+([1-9]\d*)\b/i,
  /(^|\n)\s*(Error|ERROR|Exception|Traceback)[:\s]/m,
  /(^|\n)\s*Failed to\b/m,
  /\b(Request failed|Command failed|Permission denied|net::ERR_[A-Z_]+|ENOENT|EACCES|ECONNREFUSED|ETIMEDOUT)\b/i,
  /(^|\n)\s*(错误|异常|失败|拒绝)[:：\s]/m,
  /\b(请求失败|执行失败|操作失败|连接被拒绝)\b/,
];

const TOOL_DISPLAY_CONFIGS = {
  Bash: {
    category: "bash",
    inputStyle: "terminal",
    hideResult: true,
  },
  Read: {
    category: "read",
    inputStyle: "one-line",
    inputAction: "open-file",
    getInputValue: (input) => input.file_path || "",
    hideResult: true,
  },
  Edit: {
    category: "edit",
    inputStyle: "collapsible",
    contentType: "diff",
    getInputTitle: (input) => fileLabel(input.file_path),
    hideResult: true,
  },
  Write: {
    category: "edit",
    inputStyle: "collapsible",
    contentType: "diff",
    getInputTitle: (input) => fileLabel(input.file_path),
    hideResult: true,
  },
  ApplyPatch: {
    category: "edit",
    inputStyle: "collapsible",
    contentType: "diff",
    getInputTitle: (input) => fileLabel(input.file_path) || "补丁内容",
    hideResult: true,
  },
  Grep: {
    category: "search",
    inputStyle: "one-line",
    getInputValue: (input) => input.pattern || "",
    getInputSecondary: (input) => (input.path ? `in ${input.path}` : null),
    resultStyle: "collapsible",
    getResultTitle: (result) => {
      const count = result?.numFiles || result?.filenames?.length || 0;
      return `匹配 ${count} 个文件`;
    },
  },
  Glob: {
    category: "search",
    inputStyle: "one-line",
    getInputValue: (input) => input.pattern || "",
    getInputSecondary: (input) => (input.path ? `in ${input.path}` : null),
    resultStyle: "collapsible",
    getResultTitle: (result) => {
      const count = result?.numFiles || result?.filenames?.length || 0;
      return `匹配 ${count} 个文件`;
    },
  },
  TodoWrite: {
    category: "violet",
    inputStyle: "collapsible",
    contentType: "todo",
    getInputTitle: () => "更新待办清单",
    hideResult: true,
  },
  TodoRead: {
    category: "violet",
    inputStyle: "one-line",
    getInputValue: () => "读取待办清单",
    resultStyle: "collapsible",
  },
  Agent: {
    category: "violet",
    inputStyle: "collapsible",
    contentType: "markdown",
    getInputTitle: (input) => {
      const subagentType = input.subagent_type || "Agent";
      const description = input.description || "执行子任务";
      return `Subagent / ${subagentType}: ${description}`;
    },
    resultStyle: "collapsible",
  },
  AskUserQuestion: {
    category: "interactive",
    inputStyle: "collapsible",
    contentType: "question",
    getInputTitle: (input) => {
      const count = input.questions?.length || 0;
      if (count === 1) return input.questions[0]?.header || "问题";
      return `${count} 个问题`;
    },
    hideResult: true,
  },
  Default: {
    category: "default",
    inputStyle: "collapsible",
    getInputTitle: () => "工具参数",
    resultStyle: "collapsible",
  },
};

function fileLabel(value) {
  if (!value) return "file";
  const parts = String(value).split(/[\\/]/).filter(Boolean);
  return parts[parts.length - 1] || value;
}

function safeJsonParse(value) {
  if (!value || typeof value !== "string") return null;
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
}

function getToolConfig(toolName) {
  return TOOL_DISPLAY_CONFIGS[toolName] || TOOL_DISPLAY_CONFIGS.Default;
}

function isInternalContent(content) {
  return Boolean(content && INTERNAL_CONTENT_MARKERS.some((marker) => String(content).includes(marker)));
}

function cleanContent(content) {
  if (!content || typeof content !== "string") return "";
  return content.replace(CONTEXT_BLOCK_PATTERN, "").trim();
}

export function looksLikeMarkdownContent(content) {
  const text = cleanContent(content);
  if (!text) return false;
  return MARKDOWN_PATTERNS.some((pattern) => pattern.test(text));
}

function parseAgentPrefix(content) {
  const text = String(content || "").trim();
  const match = text.match(/^\[agent=([^\]]+)\]\s*/);
  if (!match) return { agentPrefix: "", content: text };
  return {
    agentPrefix: match[1],
    content: text.slice(match[0].length).trim(),
  };
}

function parseToolInput(event) {
  const argsMatch = String(event.content || "").match(/args=(.+)$/m);
  if (argsMatch) {
    const parsed = safeJsonParse(argsMatch[1]);
    if (parsed && typeof parsed === "object") return parsed;
  }

  const extraParsed = safeJsonParse(event.extra);
  if (extraParsed && typeof extraParsed === "object") return extraParsed;
  return {};
}

function stringifyStructured(value) {
  if (value == null) return "";
  if (typeof value === "string") return value;
  return JSON.stringify(value, null, 2);
}

function buildToolInputDisplay(event, toolName, config) {
  const input = parseToolInput(event);
  const style = config.inputStyle || "collapsible";

  if (style === "terminal") {
    const command = input.command
      || String(event.content || "")
        .replace(/^tool=Bash\nargs=/, "")
        .replace(/^tool=\w+\n/, "")
      || event.extra
      || "";
    return {
      type: "terminal",
      command,
      description: input.description || "",
    };
  }

  if (style === "one-line") {
    const getValue = config.getInputValue || (() => "");
    const getSecondary = config.getInputSecondary || (() => "");
    const value = getValue(input) || event.extra || "";
    return {
      type: "one-line",
      value,
      label: config.inputAction === "open-file" ? fileLabel(value) : "",
      secondary: getSecondary(input) || "",
      action: config.inputAction || "none",
    };
  }

  const title = (config.getInputTitle || (() => "参数"))(input);
  const contentType = config.contentType || "json";

  if (contentType === "diff") {
    return {
      type: "diff",
      title,
      filePath: input.file_path || "",
      oldContent: input.old_string || "",
      newContent: input.new_string || input.content || "",
      badge: toolName === "Write" ? "New" : "Edit",
      badgeTone: toolName === "Write" ? "success" : "warning",
    };
  }

  if (contentType === "markdown") {
    return {
      type: "markdown",
      title,
      content: input.prompt
        ? input.prompt
        : stringifyStructured(input),
    };
  }

  return {
    type: "json",
    title,
    content: stringifyStructured(input),
  };
}

function buildToolResultDisplay(event, toolName, config, isError) {
  const content = String(event.content || "");
  if (config.hideResult && !isError) return null;

  if (isError) {
    return {
      type: "error",
      content,
    };
  }

  if ((toolName === "Grep" || toolName === "Glob") && (config.resultStyle || "collapsible") === "collapsible") {
    const parsed = safeJsonParse(content);
    const filenames = Array.isArray(parsed?.filenames)
      ? parsed.filenames
      : content.split("\n").map((item) => item.trim()).filter(Boolean);
    return {
      type: "file-list",
      title: (config.getResultTitle || (() => "结果"))({
        filenames,
        numFiles: filenames.length,
      }),
      items: filenames,
    };
  }

  if (!content.trim()) return null;
  if (looksLikeMarkdownContent(content)) {
    return {
      type: "markdown",
      title: "工具输出",
      content: content.length > 12000 ? `${content.slice(0, 12000)}...` : content,
    };
  }
  return {
    type: "result",
    title: "工具输出",
    content: content.length > 2000 ? `${content.slice(0, 2000)}...` : content,
  };
}

function detectToolResultError(content) {
  const text = String(content || "");
  if (!text.trim()) return false;
  return TOOL_RESULT_ERROR_PATTERNS.some((pattern) => pattern.test(text));
}

export function prepareConversationEvents(events) {
  return (Array.isArray(events) ? events : [])
    .filter(Boolean)
    .map((event) => {
      if (["Prompt", "User", "Agent", "Thinking"].includes(event.callType)) {
        return { ...event, content: cleanContent(event.content) };
      }
      return event;
    })
    .filter((event) => {
      if (event.callType === "Token_Usage") return false;
      if (event.callType === "Raw") return false;
      if (["Prompt", "User", "Agent", "Thinking"].includes(event.callType)) {
        return Boolean(event.content && !isInternalContent(event.content));
      }
      return true;
    });
}

export function buildConversationEntries(events) {
  const prepared = prepareConversationEvents(events);
  const entries = [];

  prepared.forEach((event, index) => {
    const id = `${event.callType}-${event.time || index}-${index}`;

    if (event.callType === "Tool_Call" || event.callType === "Tool_Result") {
      const toolName = event.toolName || "Tool";
      const config = getToolConfig(toolName);
      const isError = event.callType === "Tool_Result"
        ? detectToolResultError(event.content)
        : false;
      const display = event.callType === "Tool_Call"
        ? buildToolInputDisplay(event, toolName, config)
        : buildToolResultDisplay(event, toolName, config, isError);
      if (!display) return;
      entries.push({
        id,
        kind: "tool",
        phase: event.callType === "Tool_Call" ? "input" : "result",
        toolName,
        category: config.category || "default",
        isError,
        time: event.time,
        display,
      });
      return;
    }

    if (event.callType === "Thinking") {
      entries.push({
        id,
        kind: "thinking",
        content: event.content,
        time: event.time,
      });
      return;
    }

    const role = event.callType === "Prompt" || event.callType === "User" ? "user" : "agent";
    const parsed = role === "agent" ? parseAgentPrefix(event.content) : { agentPrefix: "", content: event.content };
    if (!parsed.content) return;
    const previous = entries[entries.length - 1];
    entries.push({
      id,
      kind: "message",
      role,
      grouped: previous?.kind === "message" && previous.role === role,
      agentPrefix: parsed.agentPrefix,
      content: parsed.content,
      time: event.time,
    });
  });

  return entries;
}
