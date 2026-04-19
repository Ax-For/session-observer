(function bootstrapObserverConversationView(globalScope, factory) {
  const api = factory(globalScope);
  if (typeof module === "object" && module.exports) {
    module.exports = api;
  }
  if (globalScope) {
    globalScope.ObserverConversationView = api;
  }
})(typeof globalThis !== "undefined" ? globalThis : this, function createObserverConversationView(globalScope) {
  "use strict";

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
  const ALERT_PATTERN = /(error|failed|exception|timeout|invalid|reject|denied|拒绝|失败|错误|异常)/i;

  function defaultEscapeHtml(text) {
    return String(text)
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
      .replaceAll("'", "&#39;");
  }

  function defaultFormatShanghaiTime(value) {
    return String(value || "-");
  }

  function defaultGetToolConfig() {
    return { category: "default", inputStyle: "collapsible", resultStyle: "collapsible" };
  }

  function defaultHighlightJson(value) {
    return defaultEscapeHtml(JSON.stringify(value, null, 2));
  }

  function createSafeMarkedRenderer(markedLib, escapeHtml) {
    if (!markedLib || typeof markedLib.Renderer !== "function") return null;
    const renderer = new markedLib.Renderer();
    renderer.html = (html) => {
      const raw = typeof html === "string"
        ? html
        : (html?.raw || html?.text || "");
      return escapeHtml(raw);
    };
    return renderer;
  }

  function defaultRenderMarkdown(text) {
    if (!text) return "";
    try {
      if (globalScope && globalScope.marked && typeof globalScope.marked.parse === "function") {
        const renderer = createSafeMarkedRenderer(globalScope.marked, defaultEscapeHtml);
        return globalScope.marked.parse(text, renderer ? { renderer } : undefined);
      }
    } catch {
      // Fall through to escaped text.
    }
    return defaultEscapeHtml(text);
  }

  function resolveHelpers(helpers) {
    const safeHelpers = helpers || {};
    return {
      escapeHtml: safeHelpers.escapeHtml || defaultEscapeHtml,
      formatShanghaiTime: safeHelpers.formatShanghaiTime || defaultFormatShanghaiTime,
      getToolConfig: safeHelpers.getToolConfig || defaultGetToolConfig,
      highlightJson: safeHelpers.highlightJson || defaultHighlightJson,
      renderMarkdown: safeHelpers.renderMarkdown || defaultRenderMarkdown,
    };
  }

  function isInternalContent(content) {
    return Boolean(content && typeof content === "string" && INTERNAL_CONTENT_MARKERS.some((marker) => content.includes(marker)));
  }

  function cleanContent(content) {
    return content && typeof content === "string"
      ? content.replace(CONTEXT_BLOCK_PATTERN, "").trim()
      : content;
  }

  function prepareConversationEvents(events) {
    return (Array.isArray(events) ? events : [])
      .filter((event) => {
        if (!event) return false;
        if (event.callType === "Token_Usage") return false;
        if (event.callType === "Raw" && isInternalContent(event.content)) return false;
        if ((event.callType === "User" || event.callType === "Prompt") && isInternalContent(event.content)) return false;
        if (event.callType === "Agent" && isInternalContent(event.content)) return false;
        return true;
      })
      .map((event) => (
        event.callType === "User" || event.callType === "Prompt" || event.callType === "Agent"
          ? { ...event, content: cleanContent(event.content) }
          : event
      ));
  }

  function makeContentId(prefix, event, index) {
    const raw = event.callId || event.time || `${prefix}-${index}`;
    return `${prefix}-${String(raw).replace(/[^a-zA-Z0-9_-]/g, "-")}-${index}`;
  }

  function renderTextMessage(event, options) {
    const {
      avatar,
      avatarClass,
      agentPrefix,
      content,
      escapeHtml,
      isGrouped,
      messageIndex,
      msgType,
      renderMarkdown,
      timeStr,
    } = options;
    const groupedClass = isGrouped ? "grouped" : "";
    const avatarHtml = isGrouped ? "" : `<div class="conv-avatar ${avatarClass}">${avatar}</div>`;
    const contentId = makeContentId("content", event, messageIndex);
    const contentHtml = msgType === "agent" ? renderMarkdown(content) : escapeHtml(content);
    const prefixHtml = agentPrefix ? `<div class="conv-agent-prefix">[agent=${escapeHtml(agentPrefix)}]</div>` : "";

    return `
    <div class="conv-message ${msgType} ${groupedClass}">
      ${msgType === "user" ? "" : avatarHtml}
      <div class="conv-bubble">
        ${prefixHtml}
        <div class="conv-markdown" id="${contentId}">${contentHtml}</div>
        <div class="conv-footer-line">
          <button class="conv-copy-btn" type="button" data-copy-content-id="${contentId}">复制</button>
          <span class="conv-time">${timeStr}</span>
        </div>
      </div>
      ${msgType === "user" ? avatarHtml : ""}
    </div>`;
  }

  function parseToolInput(event) {
    const content = event.content || "";
    const extra = event.extra || "";
    let inputObj = {};

    const argsMatch = content.match(/args=(.+)$/m);
    if (argsMatch) {
      try {
        inputObj = JSON.parse(argsMatch[1]);
      } catch {
        // Ignore clipped or invalid JSON.
      }
    }

    if (!inputObj || Object.keys(inputObj).length === 0) {
      try {
        inputObj = JSON.parse(extra);
      } catch {
        inputObj = {};
      }
    }

    return inputObj;
  }

  function renderToolInput(event, toolName, config, helpers, messageIndex) {
    const style = config.inputStyle || "collapsible";
    const category = config.category || "default";
    const content = event.content || "";
    const extra = event.extra || "";
    const inputObj = parseToolInput(event);

    if (style === "terminal") {
      const command = inputObj.command || content.replace(/^tool=Bash\nargs=/, "").replace(/^tool=\w+\n/, "") || extra || "";
      const description = inputObj.description || null;
      const contentId = makeContentId("bash", event, messageIndex);

      return `
      <div class="conv-terminal-wrap" data-content-id="${contentId}">
        <div class="conv-terminal-icon">⌘</div>
        <div class="conv-terminal-pill">
          <code class="conv-terminal-code">${helpers.escapeHtml(command)}</code>
          <button class="conv-terminal-copy-btn" type="button" data-copy-terminal-id="${contentId}">⧉</button>
        </div>
      </div>
      ${description ? `<div class="conv-terminal-desc">${helpers.escapeHtml(description)}</div>` : ""}`;
    }

    if (style === "one-line") {
      const getValue = config.getInputValue || ((input) => input);
      const getSecondary = config.getInputSecondary || null;
      const action = config.inputAction || "none";
      const value = getValue(inputObj) || extra || "";
      const secondary = getSecondary ? getSecondary(inputObj) : null;

      if (action === "open-file") {
        const filename = value.split("/").pop() || value;
        return `
        <div class="conv-tool-one-line ${category} file-open">
          <span class="tool-label">${toolName}</span>
          <span class="tool-sep">/</span>
          <span class="tool-value" title="${helpers.escapeHtml(value)}">${helpers.escapeHtml(filename)}</span>
        </div>`;
      }

      return `
      <div class="conv-tool-one-line ${category}">
        <span class="tool-label">${toolName}</span>
        <span class="tool-sep">/</span>
        <span class="tool-value wrap">${helpers.escapeHtml(value)}</span>
        ${secondary ? `<span class="tool-secondary">${helpers.escapeHtml(secondary)}</span>` : ""}
      </div>`;
    }

    if (style === "collapsible") {
      const getTitle = config.getInputTitle || (() => "Parameters");
      const title = getTitle(inputObj);
      const contentType = config.contentType || "text";

      if (contentType === "diff") {
        const oldContent = inputObj.old_string || "";
        const newContent = inputObj.new_string || inputObj.content || "";
        const filePath = inputObj.file_path || "";
        const badge = toolName === "Write" ? "New" : "Edit";
        const badgeColor = toolName === "Write" ? "new" : "edit";

        return `
        <details class="conv-collapsible">
          <summary>
            <span class="coll-arrow">▶</span>
            <span class="coll-tool-name">${toolName}</span>
            <span class="coll-sep">/</span>
            <span class="coll-title">${helpers.escapeHtml(title)}</span>
          </summary>
          <div class="conv-collapsible-content">
            <div class="conv-diff">
              <div class="conv-diff-header">
                <span class="conv-diff-badge ${badgeColor}">${badge}</span>
                <span>${helpers.escapeHtml(filePath)}</span>
              </div>
              ${oldContent ? `<div class="conv-diff-old">--- old\n${helpers.escapeHtml(oldContent)}</div>` : ""}
              <div class="conv-diff-new">+++ new\n${helpers.escapeHtml(newContent)}</div>
            </div>
          </div>
        </details>`;
      }

      if (contentType === "markdown") {
        const markdownContent = inputObj.prompt
          ? inputObj.prompt
          : typeof inputObj === "string"
            ? inputObj
            : JSON.stringify(inputObj, null, 2);

        return `
        <details class="conv-collapsible">
          <summary>
            <span class="coll-arrow">▶</span>
            <span class="coll-tool-name">${toolName}</span>
            <span class="coll-sep">/</span>
            <span class="coll-title">${helpers.escapeHtml(title)}</span>
          </summary>
          <div class="conv-collapsible-content">
            <div class="conv-markdown">${helpers.renderMarkdown(markdownContent)}</div>
          </div>
        </details>`;
      }

      return `
      <details class="conv-collapsible">
        <summary>
          <span class="coll-arrow">▶</span>
          <span class="coll-tool-name">${toolName}</span>
          <span class="coll-sep">/</span>
          <span class="coll-title-plain">${helpers.escapeHtml(title)}</span>
        </summary>
        <div class="conv-collapsible-content">
          <pre>${helpers.highlightJson(inputObj)}</pre>
        </div>
      </details>`;
    }

    return `<div class="conv-tool-one-line ${category}"><span class="tool-value">${helpers.escapeHtml(extra)}</span></div>`;
  }

  function renderToolResult(event, toolName, config, helpers, isError) {
    const content = event.content || "";

    if (config.hideResult && !isError) {
      return "";
    }

    if (isError) {
      return `
      <div class="conv-tool-error">
        <div class="conv-error-icon">✕</div>
        <div class="conv-error-content">${helpers.escapeHtml(content)}</div>
      </div>`;
    }

    if ((config.resultStyle || "collapsible") === "collapsible" && (toolName === "Grep" || toolName === "Glob")) {
      let filenames = [];
      try {
        const parsed = JSON.parse(content);
        filenames = parsed.filenames || [];
      } catch {
        filenames = content.split("\n").filter((line) => line.trim());
      }

      const getResultTitle = config.getResultTitle || (() => "Result");
      const title = getResultTitle({ filenames, numFiles: filenames.length });

      return `
      <details class="conv-collapsible">
        <summary>
          <span class="coll-arrow">▶</span>
          <span class="coll-title">${helpers.escapeHtml(title)}</span>
        </summary>
        <div class="conv-collapsible-content">
          <div class="conv-file-list">
            ${filenames.map((filename) => `<div class="conv-file-item">${helpers.escapeHtml(filename)}</div>`).join("")}
          </div>
        </div>
      </details>`;
    }

    const truncatedContent = content.length > 2000 ? `${content.slice(0, 2000)}...` : content;
    return `
    <details class="conv-collapsible">
      <summary>
        <span class="coll-arrow">▶</span>
        <span class="coll-title">Result</span>
      </summary>
      <div class="conv-collapsible-content">
        <pre>${helpers.escapeHtml(truncatedContent)}</pre>
      </div>
    </details>`;
  }

  function renderToolMessage(event, prevEvent, helpers, messageIndex) {
    const toolName = event.toolName || "unknown";
    const config = helpers.getToolConfig(toolName);
    const category = config.category || "default";
    const content = event.content || "";
    const isInput = event.callType === "Tool_Call";
    const isError = content && ALERT_PATTERN.test(content);
    const toolContentHtml = isInput
      ? renderToolInput(event, toolName, config, helpers, messageIndex)
      : renderToolResult(event, toolName, config, helpers, isError);

    if (!toolContentHtml) return "";

    return `
    <div class="conv-message tool ${category} ${isError ? "error" : ""}">
      ${toolContentHtml}
      <div class="conv-tool-time">${helpers.formatShanghaiTime(event.time)}</div>
    </div>`;
  }

  function renderThinkingMessage(event, helpers, messageIndex) {
    const content = event.content || "";
    const contentId = makeContentId("thinking", event, messageIndex);
    const truncatedContent = content.length > 500 ? `${content.slice(0, 500)}...` : content;

    return `
    <div class="conv-message thinking">
      <div class="conv-avatar agent">💭</div>
      <div class="conv-bubble">
        <details class="conv-collapsible">
          <summary>思考过程</summary>
          <div class="conv-collapsible-content" id="${contentId}">${helpers.escapeHtml(truncatedContent)}</div>
        </details>
        <div class="conv-footer-line">
          <button class="conv-copy-btn" type="button" data-copy-content-id="${contentId}">复制</button>
          <span class="conv-time">${helpers.formatShanghaiTime(event.time)}</span>
        </div>
      </div>
    </div>`;
  }

  function renderConversationMessage(event, prevEvent, helpers, messageIndex) {
    const callType = event.callType;
    const isGrouped = Boolean(
      prevEvent
      && prevEvent.callType === callType
      && (callType === "Agent" || callType === "User" || callType === "Prompt")
    );

    let msgType = "agent";
    let avatar = "A";
    let avatarClass = "agent";

    if (callType === "User" || callType === "Prompt") {
      msgType = "user";
      avatar = "U";
      avatarClass = "user";
    } else if (callType === "Tool_Call" || callType === "Tool_Result") {
      msgType = "tool";
      avatar = "🔧";
      avatarClass = "tool";
    } else if (callType === "Thinking") {
      msgType = "thinking";
      avatar = "💭";
      avatarClass = "agent";
    } else if (callType === "Raw") {
      msgType = "agent";
      avatar = "R";
      avatarClass = "agent";
    }

    let agentPrefix = "";
    let content = event.content || "";
    const agentMatch = content.match(/^\[agent=([^\]]+)\]/);
    if (agentMatch) {
      agentPrefix = agentMatch[1];
      content = content.slice(agentMatch[0].length).trim();
    }

    if (msgType === "tool") {
      return renderToolMessage(event, prevEvent, helpers, messageIndex);
    }
    if (msgType === "thinking") {
      return renderThinkingMessage({ ...event, content }, helpers, messageIndex);
    }

    return renderTextMessage(event, {
      avatar,
      avatarClass,
      agentPrefix,
      content,
      escapeHtml: helpers.escapeHtml,
      isGrouped,
      messageIndex,
      msgType,
      renderMarkdown: helpers.renderMarkdown,
      timeStr: helpers.formatShanghaiTime(event.time),
    });
  }

  function renderConversationHtml(payload, helpers) {
    const resolved = resolveHelpers(helpers);
    const safePayload = payload || {};
    const conversationEvents = prepareConversationEvents(safePayload.events);

    if (conversationEvents.length === 0) {
      return '<div class="conv-empty">暂无对话记录</div>';
    }

    const messagesHtml = conversationEvents
      .map((event, index) => renderConversationMessage(event, index > 0 ? conversationEvents[index - 1] : null, resolved, index))
      .join("");
    const offset = Number(safePayload.offset) || 0;
    const total = Number(safePayload.total) || conversationEvents.length;
    const hasMore = offset < total;
    const loadingIndicatorHtml = hasMore
      ? '<div class="conv-loading-more" id="inlineConvLoadingMore">向下滚动加载更多...</div>'
      : '<div style="text-align:center;padding:12px;color:var(--ink-soft);font-size:var(--font-xs);">已全部加载</div>';

    return messagesHtml + loadingIndicatorHtml;
  }

  return {
    prepareConversationEvents,
    renderConversationHtml,
  };
});
