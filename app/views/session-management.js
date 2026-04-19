(function bootstrapObserverSessionManagementView(globalScope, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) {
    module.exports = api;
  }
  if (globalScope) {
    globalScope.ObserverSessionManagementView = api;
  }
})(typeof globalThis !== "undefined" ? globalThis : this, function createObserverSessionManagementView() {
  "use strict";

  function defaultEscapeHtml(text) {
    return String(text)
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
      .replaceAll("'", "&#39;");
  }

  function defaultShortId(value, size = 8) {
    if (!value) return "-";
    return value.length <= size ? value : value.slice(0, size);
  }

  function defaultShortPathN(value, count = 3) {
    if (!value) return "-";
    const parts = String(value).split(/[\\/]/).filter(Boolean);
    if (parts.length <= count) return value;
    return `.../${parts.slice(-count).join("/")}`;
  }

  function defaultFmtTokenHuman(value) {
    const n = Number(value);
    if (!Number.isFinite(n)) return "-";
    if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1).replace(/\.0$/, "")}m`;
    if (n >= 1_000) return `${(n / 1_000).toFixed(1).replace(/\.0$/, "")}k`;
    return String(n);
  }

  function defaultHasTokenUsageData(tokenUsage) {
    if (!tokenUsage) return false;
    return ["input", "output", "total", "cachedInput", "reasoningOutput"].some((key) => {
      const value = tokenUsage[key];
      return value != null && Number.isFinite(Number(value));
    });
  }

  function defaultFmtNum(value) {
    const n = Number(value);
    if (!Number.isFinite(n)) return "-";
    return n.toLocaleString("zh-CN");
  }

  function defaultFormatShanghaiTime(value) {
    return String(value || "-");
  }

  function resolveHelpers(helpers) {
    const safeHelpers = helpers || {};
    return {
      selectedSessionIds: safeHelpers.selectedSessionIds instanceof Set ? safeHelpers.selectedSessionIds : new Set(),
      escapeHtml: safeHelpers.escapeHtml || defaultEscapeHtml,
      fmtNum: safeHelpers.fmtNum || defaultFmtNum,
      fmtTokenHuman: safeHelpers.fmtTokenHuman || defaultFmtTokenHuman,
      formatShanghaiTime: safeHelpers.formatShanghaiTime || defaultFormatShanghaiTime,
      hasTokenUsageData: safeHelpers.hasTokenUsageData || defaultHasTokenUsageData,
      shortId: safeHelpers.shortId || defaultShortId,
      shortPathN: safeHelpers.shortPathN || defaultShortPathN,
    };
  }

  function findSessionById(groups, sessionId) {
    if (!groups || !sessionId) return null;
    for (const sessions of Object.values(groups)) {
      const found = sessions.find((session) => session.sessionId === sessionId);
      if (found) return found;
    }
    return null;
  }

  function renderSessionCardHtml(session, helpers) {
    const {
      selectedSessionIds,
      escapeHtml,
      fmtTokenHuman,
      formatShanghaiTime,
      hasTokenUsageData,
      shortId,
    } = helpers;

    const title = session.sessionTitle || session.fallbackTitle || "未命名会话";
    const tokenMeta = hasTokenUsageData(session.aggregateToken)
      ? `Tok ${fmtTokenHuman(session.aggregateToken.total)}`
      : "Tok -";
    const platform = session.sourceType || "unknown";
    const platformLabel = platform === "claude" ? "CC" : platform === "codex" ? "CX" : platform;
    const platformFullName = platform === "claude" ? "Claude Code" : platform === "codex" ? "Codex" : platform;
    const isSelected = selectedSessionIds.has(session.sessionId);
    const checkedClass = isSelected ? "checked" : "";
    const selectedClass = isSelected ? "selected" : "";

    return `<article class="session-card ${selectedClass}" data-session-id="${escapeHtml(session.sessionId)}">
    <div class="session-card-checkbox ${checkedClass}" data-checkbox-session-id="${escapeHtml(session.sessionId)}" role="checkbox" aria-checked="${isSelected}" tabindex="0"></div>
    <span class="card-platform"><span class="chip chip-platform chip-${escapeHtml(platform)}" title="${escapeHtml(platformFullName)}">${escapeHtml(platformLabel)}</span></span>
    <div class="card-info">
      <div class="card-title-row">
        <span class="card-title has-tip" data-tip="${escapeHtml(title)}">${escapeHtml(title)}</span>
        <span class="card-nav-hint" title="点击查看事件流">→</span>
      </div>
      <div class="card-meta">
        <span class="mono">${escapeHtml(shortId(session.sessionId, 16))}</span>
        <span>事件 ${session.count}</span>
        <span>${tokenMeta}</span>
        <span>最近 ${formatShanghaiTime(session.latest)}</span>
      </div>
    </div>
    <div class="card-actions">
      <button class="card-btn" data-action="copy-id" data-session-id="${escapeHtml(session.sessionId)}" title="复制 Session ID">复制</button>
      <button class="card-btn" data-action="view-conversation" data-session-id="${escapeHtml(session.sessionId)}">查看对话</button>
      <button class="card-btn" data-action="rename" data-session-id="${escapeHtml(session.sessionId)}" data-session-name="${escapeHtml(session.sessionTitle || "")}">重命名</button>
      <button class="card-btn btn-danger" data-action="delete" data-session-id="${escapeHtml(session.sessionId)}" data-session-name="${escapeHtml(title)}">删除</button>
    </div>
  </article>`;
  }

  function renderSessionGroupsHtml(groups, helpers) {
    const resolved = resolveHelpers(helpers);
    const entries = Object.entries(groups || {});

    if (entries.length === 0) {
      return '<div class="empty">无匹配会话</div>';
    }

    return entries.map(([cwd, sessions]) => {
      const cardsHtml = sessions.map((session) => renderSessionCardHtml(session, resolved)).join("");
      return `<section class="session-group">
      <header class="group-header">
        <span class="group-cwd-icon">📁</span>
        <span class="group-cwd has-tip" data-tip="${resolved.escapeHtml(cwd)}">${resolved.escapeHtml(resolved.shortPathN(cwd, 5))}</span>
        <span class="group-count">${sessions.length} 个会话</span>
      </header>
      <div class="group-sessions">${cardsHtml}</div>
    </section>`;
    }).join("");
  }

  function renderSessionDetailHtml(session, helpers) {
    const {
      escapeHtml,
      fmtNum,
      formatShanghaiTime,
      hasTokenUsageData,
    } = resolveHelpers(helpers);
    const tokenData = session.aggregateToken;
    const models = Array.isArray(session.models) ? session.models : [];

    return `
    <div class="detail-field">
      <span class="detail-label">会话名称</span>
      <span class="detail-value">${escapeHtml(session.sessionTitle || session.fallbackTitle || "未命名")}</span>
    </div>
    <div class="detail-field">
      <span class="detail-label">Session ID</span>
      <span class="detail-value mono">${escapeHtml(session.sessionId)}</span>
    </div>
    <div class="detail-field">
      <span class="detail-label">平台</span>
      <span class="detail-value"><span class="chip chip-platform chip-${escapeHtml(session.sourceType)}">${escapeHtml(session.sourceType)}</span></span>
    </div>
    <div class="detail-field">
      <span class="detail-label">模型</span>
      <span class="detail-value mono">${models.length > 0 ? models.map((model) => escapeHtml(model)).join("<br>") : "-"}</span>
    </div>
    <div class="detail-field">
      <span class="detail-label">事件数</span>
      <span class="detail-value">${session.count}</span>
    </div>
    <div class="detail-field">
      <span class="detail-label">最近活跃</span>
      <span class="detail-value">${formatShanghaiTime(session.latest)}</span>
    </div>
    <div class="detail-field">
      <span class="detail-label">工作目录</span>
      <span class="detail-value mono has-tip" data-tip="${escapeHtml(session.cwd || "-")}">${escapeHtml(session.cwd || "-")}</span>
    </div>
    ${hasTokenUsageData(tokenData) ? `
    <div class="detail-field">
      <span class="detail-label">Token 使用</span>
      <span class="detail-value">
        Total: ${fmtNum(tokenData.total)}<br>
        In: ${fmtNum(tokenData.input)} · Out: ${fmtNum(tokenData.output)}<br>
        Cache: ${fmtNum(tokenData.cachedInput)} · Reason: ${fmtNum(tokenData.reasoningOutput)}
      </span>
    </div>` : ""}
    <div class="detail-field" style="grid-column: 1 / -1; margin-top: 8px;">
      <div style="display: flex; gap: 8px;">
        <button class="card-btn" data-action="view-events" data-session-id="${escapeHtml(session.sessionId)}" style="flex: 1; text-align: center;">查看事件流 →</button>
        <button class="card-btn" data-action="view-conversation" data-session-id="${escapeHtml(session.sessionId)}" style="flex: 1; text-align: center;">查看对话 →</button>
      </div>
    </div>
  `;
  }

  return {
    findSessionById,
    renderSessionCardHtml,
    renderSessionDetailHtml,
    renderSessionGroupsHtml,
  };
});
