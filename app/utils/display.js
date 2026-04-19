(function bootstrapObserverDisplayUtils(globalScope, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) {
    module.exports = api;
  }
  if (globalScope) {
    globalScope.ObserverDisplayUtils = api;
  }
})(typeof globalThis !== "undefined" ? globalThis : this, function createObserverDisplayUtilsModule() {
  "use strict";

  const TOOL_DISPLAY_CONFIGS = {
    Bash: {
      category: "bash",
      inputStyle: "terminal",
      inputAction: "copy",
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
      getInputTitle: (input) => input.file_path?.split("/").pop() || input.file_path || "file",
      hideResult: true,
    },
    Write: {
      category: "edit",
      inputStyle: "collapsible",
      contentType: "diff",
      getInputTitle: (input) => input.file_path?.split("/").pop() || input.file_path || "file",
      hideResult: true,
    },
    ApplyPatch: {
      category: "edit",
      inputStyle: "collapsible",
      contentType: "diff",
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
        return `Found ${count} ${count === 1 ? "file" : "files"}`;
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
        return `Found ${count} ${count === 1 ? "file" : "files"}`;
      },
    },
    TodoWrite: {
      category: "violet",
      inputStyle: "collapsible",
      contentType: "todo",
      getInputTitle: () => "Updating todo list",
      hideResult: true,
    },
    TodoRead: {
      category: "violet",
      inputStyle: "one-line",
      getInputValue: () => "reading list",
      resultStyle: "collapsible",
    },
    TaskCreate: {
      category: "violet",
      inputStyle: "one-line",
      getInputValue: (input) => input.subject || "Creating task",
      getInputSecondary: (input) => input.status || null,
      hideResult: true,
    },
    TaskUpdate: {
      category: "violet",
      inputStyle: "one-line",
      getInputValue: (input) => {
        const parts = [];
        if (input.taskId) parts.push(`#${input.taskId}`);
        if (input.status) parts.push(input.status);
        if (input.subject) parts.push(`"${input.subject}"`);
        return parts.join(" → ") || "updating";
      },
      hideResult: true,
    },
    TaskList: {
      category: "violet",
      inputStyle: "one-line",
      getInputValue: () => "listing tasks",
      resultStyle: "collapsible",
    },
    TaskGet: {
      category: "violet",
      inputStyle: "one-line",
      getInputValue: (input) => (input.taskId ? `#${input.taskId}` : "fetching"),
      resultStyle: "collapsible",
    },
    Agent: {
      category: "purple",
      inputStyle: "collapsible",
      contentType: "markdown",
      getInputTitle: (input) => {
        const subagentType = input.subagent_type || "Agent";
        const description = input.description || "Running task";
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
        const hasAnswers = input.answers && Object.keys(input.answers).length > 0;
        if (count === 1) {
          const header = input.questions[0]?.header || "Question";
          return hasAnswers ? `${header} — answered` : header;
        }
        return hasAnswers ? `${count} questions — answered` : `${count} questions`;
      },
      hideResult: true,
    },
    Default: {
      category: "default",
      inputStyle: "collapsible",
      getInputTitle: () => "Parameters",
      resultStyle: "collapsible",
    },
  };

  const shFormatter = new Intl.DateTimeFormat("zh-CN", {
    timeZone: "Asia/Shanghai",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  });

  function getToolConfig(toolName) {
    return TOOL_DISPLAY_CONFIGS[toolName] || TOOL_DISPLAY_CONFIGS.Default;
  }

  function downloadJsonl(jsonl, filename, env = {}) {
    const blobCtor = env.blobCtor || (typeof Blob === "function" ? Blob : null);
    const documentRef = env.documentRef || (typeof document !== "undefined" ? document : null);
    const urlRef = env.urlRef || (typeof URL !== "undefined" ? URL : null);
    if (!blobCtor || !documentRef?.createElement || !documentRef?.body || !urlRef?.createObjectURL) return;
    const blob = new blobCtor([jsonl], { type: "application/jsonl" });
    const url = urlRef.createObjectURL(blob);
    const link = documentRef.createElement("a");
    link.href = url;
    link.download = filename;
    documentRef.body.appendChild(link);
    link.click?.();
    documentRef.body.removeChild(link);
    urlRef.revokeObjectURL?.(url);
  }

  function escapeHtml(text) {
    return String(text)
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
      .replaceAll("'", "&#39;");
  }

  function highlightMatch(text, query) {
    if (!query || !text) return escapeHtml(text);
    const escaped = escapeHtml(text);
    const lowerEscaped = escaped.toLowerCase();
    const lowerQuery = query.toLowerCase();
    let result = "";
    let lastIdx = 0;
    let idx = lowerEscaped.indexOf(lowerQuery, 0);
    while (idx !== -1) {
      result += escaped.slice(lastIdx, idx);
      result += `<mark>${escaped.slice(idx, idx + query.length)}</mark>`;
      lastIdx = idx + query.length;
      idx = lowerEscaped.indexOf(lowerQuery, lastIdx);
    }
    result += escaped.slice(lastIdx);
    return result;
  }

  function shortId(value, size = 8) {
    if (!value) return "-";
    return value.length <= size ? value : value.slice(0, size);
  }

  function shortPathN(value, count = 3) {
    if (!value) return "-";
    const parts = value.split(/[\\/]/).filter(Boolean);
    if (parts.length <= count) return value;
    return `.../${parts.slice(-count).join("/")}`;
  }

  function shortModel(value) {
    if (!value) return "-";
    const qwenMatch = value.match(/^(qwen\d+\.\d+)/);
    if (qwenMatch) return qwenMatch[1];
    const claudeMatch = value.match(/^(claude-)?(sonnet|opus|haiku)-(\d+)/i);
    if (claudeMatch) return `${claudeMatch[2]}-${claudeMatch[3]}`;
    const gptMatch = value.match(/^(gpt-\d+\.\d+)/);
    if (gptMatch) return gptMatch[1];
    return value.length > 12 ? value.slice(0, 12) : value;
  }

  function fmtNum(value) {
    const n = Number(value);
    if (!Number.isFinite(n)) return "-";
    return n.toLocaleString("zh-CN");
  }

  function fmtTokenHuman(value) {
    const n = Number(value);
    if (!Number.isFinite(n)) return "-";
    if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1).replace(/\.0$/, "")}m`;
    if (n >= 1_000) return `${(n / 1_000).toFixed(1).replace(/\.0$/, "")}k`;
    return String(n);
  }

  function hasTokenUsageData(tokenUsage) {
    if (!tokenUsage) return false;
    return ["input", "output", "total", "cachedInput", "reasoningOutput"].some((key) => {
      const value = tokenUsage[key];
      return value != null && Number.isFinite(Number(value));
    });
  }

  function rowHeightForDensity(density) {
    return density === "compact" ? 40 : 48;
  }

  function sessionRowHeightForDensity(density) {
    return density === "compact" ? 72 : 84;
  }

  function formatShanghaiTime(input) {
    const date = new Date(input);
    if (Number.isNaN(date.getTime())) return input;
    const parts = shFormatter.formatToParts(date);
    const get = (type) => parts.find((part) => part.type === type)?.value || "00";
    const ms = String(date.getUTCMilliseconds()).padStart(3, "0");
    return `${get("year")}-${get("month")}-${get("day")} ${get("hour")}:${get("minute")}:${get("second")}.${ms}`;
  }

  function highlightJson(value) {
    const json = JSON.stringify(value, null, 2);
    const tokenPattern =
      /("(\\u[\da-fA-F]{4}|\\[^u]|[^\\"])*")(\s*:)?|\btrue\b|\bfalse\b|\bnull\b|-?\d+(?:\.\d+)?(?:[eE][+\-]?\d+)?/g;
    let result = "";
    let lastIndex = 0;

    json.replace(tokenPattern, (match, str, _esc, keyPart, offset) => {
      result += escapeHtml(json.slice(lastIndex, offset));
      const safeMatch = escapeHtml(match);
      if (str) {
        result += keyPart
          ? `<span class="json-key">${safeMatch}</span>`
          : `<span class="json-string">${safeMatch}</span>`;
      } else if (match === "true" || match === "false") {
        result += `<span class="json-boolean">${safeMatch}</span>`;
      } else if (match === "null") {
        result += `<span class="json-null">${safeMatch}</span>`;
      } else {
        result += `<span class="json-number">${safeMatch}</span>`;
      }
      lastIndex = offset + match.length;
      return match;
    });

    result += escapeHtml(json.slice(lastIndex));
    return result;
  }

  return {
    TOOL_DISPLAY_CONFIGS,
    getToolConfig,
    downloadJsonl,
    escapeHtml,
    highlightMatch,
    shortId,
    shortPathN,
    shortModel,
    fmtNum,
    fmtTokenHuman,
    hasTokenUsageData,
    rowHeightForDensity,
    sessionRowHeightForDensity,
    formatShanghaiTime,
    highlightJson,
  };
});
