(function bootstrapObserverStreamUi(globalScope, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) {
    module.exports = api;
  }
  if (globalScope) {
    globalScope.ObserverStreamUi = api;
  }
})(typeof globalThis !== "undefined" ? globalThis : this, function createObserverStreamUiModule() {
  "use strict";

  const EMPTY_TOKEN_USAGE = { input: 0, output: 0, total: 0, cachedInput: 0, reasoningOutput: 0 };

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
    const parts = String(value || "").split(/[\\/]/).filter(Boolean);
    if (parts.length <= count) return value;
    return `.../${parts.slice(-count).join("/")}`;
  }

  function defaultShortModel(value) {
    return String(value || "-");
  }

  function defaultFmtNum(value) {
    return Number(value).toLocaleString("zh-CN");
  }

  function defaultFmtTokenHuman(value) {
    return String(Number(value));
  }

  function defaultHighlightMatch(text) {
    return defaultEscapeHtml(text || "");
  }

  function defaultHasTokenUsageData(tokenUsage) {
    if (!tokenUsage) return false;
    return ["input", "output", "total", "cachedInput", "reasoningOutput"].some((key) => {
      const value = tokenUsage[key];
      return value != null && Number.isFinite(Number(value));
    });
  }

  function resolveHelpers(helpers) {
    const safeHelpers = helpers || {};
    return {
      escapeHtml: safeHelpers.escapeHtml || defaultEscapeHtml,
      highlightMatch: safeHelpers.highlightMatch || defaultHighlightMatch,
      shortId: safeHelpers.shortId || defaultShortId,
      shortPathN: safeHelpers.shortPathN || defaultShortPathN,
      shortModel: safeHelpers.shortModel || defaultShortModel,
      fmtNum: safeHelpers.fmtNum || defaultFmtNum,
      fmtTokenHuman: safeHelpers.fmtTokenHuman || defaultFmtTokenHuman,
      hasTokenUsageData: safeHelpers.hasTokenUsageData || defaultHasTokenUsageData,
      formatShanghaiTime: safeHelpers.formatShanghaiTime || ((value) => String(value || "-")),
      rowHeightForDensity: safeHelpers.rowHeightForDensity || (() => 48),
      sessionRowHeightForDensity: safeHelpers.sessionRowHeightForDensity || (() => 84),
    };
  }

  function resolveCore(core) {
    return {
      addTokenUsage: core?.addTokenUsage || ((base, next) => ({ ...(base || EMPTY_TOKEN_USAGE), ...(next || {}) })),
      buildSessionGroups: core?.buildSessionGroups || (() => []),
      collectMeta: core?.collectMeta || (() => ({ models: [], types: [], platforms: [] })),
    };
  }

  function dashboardTypeClass(type) {
    const map = {
      Prompt: "type-prompt",
      User: "type-prompt",
      Agent: "type-agent",
      Tool_Call: "type-tool-call",
      Tool_Result: "type-tool-result",
      Token_Usage: "type-token-usage",
      Thinking: "type-thinking",
      Raw: "type-raw",
    };
    return map[type] || "type-raw";
  }

  function getTypeDescription(type) {
    const descriptions = {
      Prompt: "用户输入的消息（Codex 格式）",
      User: "用户输入的消息（Claude Code 格式）",
      Agent: "AI 模型生成的回复消息",
      Tool_Call: "工具调用请求，包含工具名称和参数",
      Tool_Result: "工具执行返回的结果",
      Token_Usage: "Token 使用量统计事件",
      Thinking: "模型的内部推理过程（仅 Claude 模型）",
      Raw: "未解析或特殊格式的原始事件",
    };
    return descriptions[type] || "未知事件类型";
  }

  function createStreamUiController(config) {
    const state = config?.state || {};
    const els = config?.els || {};
    const documentRef = config?.documentRef || (typeof document !== "undefined" ? document : null);
    const helpers = resolveHelpers(config?.helpers);
    const core = resolveCore(config?.core);
    const callbacks = {
      isVisibleInCurrentMode: config?.callbacks?.isVisibleInCurrentMode || (() => true),
      isServerMode: config?.callbacks?.isServerMode || (() => false),
    };

    const controller = {
      computeDashboardStats() {
        let tokenTotal = { ...EMPTY_TOKEN_USAGE };

        if (callbacks.isServerMode()) {
          for (const session of state.sessions || []) {
            if (session.aggregateToken) {
              tokenTotal = core.addTokenUsage(tokenTotal, session.aggregateToken);
            }
          }
        } else {
          for (const event of state.filtered || []) {
            if (event.tokenUsage) {
              tokenTotal = core.addTokenUsage(tokenTotal, event.tokenUsage);
            }
          }
        }

        const typeCounts = {};
        for (const event of state.filtered || []) {
          const type = event.callType || "Unknown";
          typeCounts[type] = (typeCounts[type] || 0) + 1;
        }

        const modelCounts = {};
        if (callbacks.isServerMode()) {
          for (const session of state.sessions || []) {
            for (const model of session.models || []) {
              modelCounts[model] = (modelCounts[model] || 0) + 1;
            }
          }
        } else {
          for (const event of state.filtered || []) {
            const model = event.model || "unknown";
            modelCounts[model] = (modelCounts[model] || 0) + 1;
          }
        }

        const platformCounts = {
          codex: { sessions: 0, events: 0, models: new Set() },
          claude: { sessions: 0, events: 0, models: new Set() },
        };
        if (callbacks.isServerMode()) {
          for (const session of state.sessions || []) {
            const platform = session.sourceType || "unknown";
            if (platform !== "codex" && platform !== "claude") continue;
            platformCounts[platform].sessions += 1;
            platformCounts[platform].events += session.count || 0;
            for (const model of session.models || []) {
              platformCounts[platform].models.add(model);
            }
          }
        } else {
          const visibleEvents = (state.events || []).filter(callbacks.isVisibleInCurrentMode);
          for (const event of visibleEvents) {
            const platform = event.sourceType || "unknown";
            if (platform !== "codex" && platform !== "claude") continue;
            platformCounts[platform].events += 1;
            if (event.model) platformCounts[platform].models.add(event.model);
          }
          for (const group of state.sessionGroups || []) {
            const platform = group.sourceType || "unknown";
            if (platform !== "codex" && platform !== "claude") continue;
            platformCounts[platform].sessions += 1;
          }
        }

        return {
          tokenTotal,
          typeCounts,
          modelCounts,
          platformCounts,
          totalVisible: callbacks.isServerMode()
            ? state.totalVisible
            : (state.events || []).filter(callbacks.isVisibleInCurrentMode).length,
          totalMatching: callbacks.isServerMode() ? state.totalMatching : (state.filtered || []).length,
          sessionCount: callbacks.isServerMode() ? (state.sessions || []).length : (state.sessionGroups || []).length,
          loadedCount: (state.filtered || []).length,
        };
      },

      renderTypeBars(typeCounts, total) {
        const container = documentRef?.getElementById?.("typeBars");
        if (!container) return;
        if (!typeCounts || Object.keys(typeCounts).length === 0) {
          container.innerHTML = '<div style="color: var(--ink-soft); font-size: 0.66rem;">无数据</div>';
          return;
        }
        const sortedTypes = Object.entries(typeCounts).sort((a, b) => b[1] - a[1]);
        container.innerHTML = sortedTypes
          .map(([type, count]) => {
            const pct = total > 0 ? Math.round((count / total) * 100) : 0;
            const typeDesc = getTypeDescription(type);
            return `<div class="type-bar-row">
      <span class="type-bar-label has-tip" data-tip="${typeDesc}">${helpers.escapeHtml(type)}</span>
      <div class="type-bar-track">
        <div class="type-bar-fill ${dashboardTypeClass(type)}" style="width: ${pct}%"></div>
      </div>
      <span class="type-bar-count">${helpers.fmtNum(count)}</span>
    </div>`;
          })
          .join("");
      },

      renderModelList(modelCounts) {
        const container = documentRef?.getElementById?.("modelList");
        if (!container) return;
        if (!modelCounts || Object.keys(modelCounts).length === 0) {
          container.innerHTML = '<div style="color: var(--ink-soft); font-size: 0.66rem;">无数据</div>';
          return;
        }
        const sortedModels = Object.entries(modelCounts).sort((a, b) => b[1] - a[1]).slice(0, 5);
        const isSessionBased = callbacks.isServerMode();
        container.innerHTML = sortedModels
          .map(([model, count]) => {
            const tip = isSessionBased
              ? `在 ${helpers.fmtNum(count)} 个会话中被使用`
              : `产生 ${helpers.fmtNum(count)} 个事件`;
            return `<div class="model-item">
      <span class="model-name has-tip" data-tip="${tip}">${helpers.escapeHtml(model)}</span>
      <span class="model-count">${helpers.fmtNum(count)}</span>
    </div>`;
          })
          .join("");
      },

      renderPlatformBars(platformData) {
        const container = documentRef?.getElementById?.("platformBars");
        if (!container) return;
        const codexModels = [...(platformData?.codex?.models || [])];
        const claudeModels = [...(platformData?.claude?.models || [])];
        const claudeVersion = state.claudeVersion || "unknown";
        const codexVersion = state.codexVersion || "unknown";
        const claudeTip = `Claude Code\n版本: ${claudeVersion}\n会话: ${helpers.fmtNum(platformData?.claude?.sessions || 0)}\n事件: ${helpers.fmtNum(platformData?.claude?.events || 0)}\n模型: ${claudeModels.length > 0 ? claudeModels.join(", ") : "-"}`;
        const codexTip = `Codex\n版本: ${codexVersion}\n会话: ${helpers.fmtNum(platformData?.codex?.sessions || 0)}\n事件: ${helpers.fmtNum(platformData?.codex?.events || 0)}\n模型: ${codexModels.length > 0 ? codexModels.join(", ") : "-"}`;
        container.innerHTML = `
    <div class="platform-bar">
      <div class="platform-bar-fill codex has-tip" data-tip="${helpers.escapeHtml(codexTip)}">
        <span class="platform-bar-value">${helpers.fmtNum(platformData?.codex?.sessions || 0)}</span>
      </div>
      <span class="platform-bar-sessions">${helpers.fmtNum(platformData?.codex?.sessions || 0)} 会话</span>
      <span class="platform-label">Codex</span>
      <span class="platform-bar-meta">${helpers.fmtNum(platformData?.codex?.events || 0)} 事件 · ${helpers.escapeHtml(codexVersion)}</span>
      <span class="platform-bar-models">${codexModels.length > 0 ? codexModels.map(helpers.shortModel).join(", ") : "-"}</span>
    </div>
    <div class="platform-bar">
      <div class="platform-bar-fill claude has-tip" data-tip="${helpers.escapeHtml(claudeTip)}">
        <span class="platform-bar-value">${helpers.fmtNum(platformData?.claude?.sessions || 0)}</span>
      </div>
      <span class="platform-bar-sessions">${helpers.fmtNum(platformData?.claude?.sessions || 0)} 会话</span>
      <span class="platform-label">Claude Code</span>
      <span class="platform-bar-meta">${helpers.fmtNum(platformData?.claude?.events || 0)} 事件 · ${helpers.escapeHtml(claudeVersion)}</span>
      <span class="platform-bar-models">${claudeModels.length > 0 ? claudeModels.map(helpers.shortModel).join(", ") : "-"}</span>
    </div>`;
      },

      renderStats() {
        const stats = controller.computeDashboardStats();
        const scopeEl = documentRef?.getElementById?.("dashScope");
        if (scopeEl) {
          scopeEl.textContent = state.selectedSessionId
            ? `Session: ${helpers.shortId(state.selectedSessionId, 12)}`
            : "全部会话";
        }

        const values = {
          tokenInput: helpers.fmtTokenHuman(stats.tokenTotal.input),
          tokenOutput: helpers.fmtTokenHuman(stats.tokenTotal.output),
          tokenTotal: helpers.fmtTokenHuman(stats.tokenTotal.total),
          tokenCached: helpers.fmtTokenHuman(stats.tokenTotal.cachedInput),
          tokenReason: helpers.fmtTokenHuman(stats.tokenTotal.reasoningOutput),
          countTotal: helpers.fmtNum(stats.totalVisible),
          countMatch: helpers.fmtNum(stats.totalMatching),
          countSessions: helpers.fmtNum(stats.sessionCount),
          countLoaded: helpers.fmtNum(stats.loadedCount),
        };
        Object.entries(values).forEach(([id, value]) => {
          const element = documentRef?.getElementById?.(id);
          if (element) element.textContent = value;
        });

        controller.renderTypeBars(stats.typeCounts, stats.totalVisible);
        controller.renderModelList(stats.modelCounts);
        controller.renderPlatformBars(stats.platformCounts);
      },

      renderEmptyRows() {
        if (!els.rows) return;
        els.rows.innerHTML = '<div class="empty">无匹配数据</div>';
        els.rows.scrollTop = 0;
        state.scrollTop = 0;
        state.viewportHeight = els.rows.clientHeight || 0;
        if (els.loadMoreBtn) {
          els.loadMoreBtn.hidden = !state.hasMore;
          els.loadMoreBtn.textContent = state.hasMore ? "加载更多" : "已全部加载";
        }
        controller.renderStats();
      },

      getVirtualSlice() {
        const total = (state.filtered || []).length;
        const rowHeight = helpers.rowHeightForDensity();
        const viewportHeight = els.rows?.clientHeight || state.viewportHeight || 640;
        const overscan = 6;
        const start = Math.max(0, Math.floor((state.scrollTop || 0) / rowHeight) - overscan);
        const visibleCount = Math.ceil(viewportHeight / rowHeight) + overscan * 2;
        const end = Math.min(total, start + visibleCount);
        return {
          total,
          rowHeight,
          start,
          end,
          offsetTop: start * rowHeight,
          totalHeight: total * rowHeight,
        };
      },

      renderVirtualRows() {
        if (!(state.filtered || []).length) {
          controller.renderEmptyRows();
          return;
        }

        state.rowHeight = helpers.rowHeightForDensity();
        state.viewportHeight = els.rows?.clientHeight || state.viewportHeight || 640;
        const slice = controller.getVirtualSlice();
        const query = els.searchInput?.value?.trim?.() || "";
        const html = (state.filtered || [])
          .slice(slice.start, slice.end)
          .map((event, localIdx) => {
            const idx = slice.start + localIdx;
            const active = idx === state.selectedRowIndex ? "active" : "";
            const toolOrExtra = event.toolName ? `tool:${event.toolName}` : event.extra;
            const shownTime = helpers.formatShanghaiTime(event.time);
            const tokenLabel = event.tokenUsage
              ? `Tok ${helpers.fmtTokenHuman(event.tokenUsage.total)} total · ${helpers.fmtTokenHuman(event.tokenUsage.input)} in · ${helpers.fmtTokenHuman(event.tokenUsage.output)} out`
              : "";
            const tokenTitle = event.tokenUsage
              ? `In ${helpers.fmtNum(event.tokenUsage.input)} | Out ${helpers.fmtNum(event.tokenUsage.output)} | Total ${helpers.fmtNum(event.tokenUsage.total)} | Cache ${helpers.fmtNum(event.tokenUsage.cachedInput)} | Reason ${helpers.fmtNum(event.tokenUsage.reasoningOutput)}`
              : "";
            const hasExpandable = event.content && event.content.length > (event.summary?.length || 0);
            return `<article class="log-row ${active}" data-index="${idx}">
  <span class="log-row-time">${helpers.escapeHtml(shownTime)}</span>
  <span class="log-row-type ${dashboardTypeClass(event.callType)}">${helpers.highlightMatch(event.callType, query)}</span>
  ${event.sourceType ? `<span class="log-row-chip chip-${helpers.escapeHtml(event.sourceType)}">${helpers.highlightMatch(event.sourceType === "claude" ? "CC" : event.sourceType === "codex" ? "CX" : event.sourceType, query)}</span>` : ""}
  <span class="log-row-model">${helpers.highlightMatch(helpers.shortModel(event.model), query)}</span>
  <span class="log-row-session">${helpers.highlightMatch(helpers.shortId(event.sessionId, 8), query)}</span>
  <span class="log-row-summary">${helpers.highlightMatch(event.summary || "", query)}</span>
  ${tokenLabel ? `<span class="log-row-token has-tip" data-tip="${helpers.escapeHtml(tokenTitle)}">${helpers.highlightMatch(`Tok ${helpers.fmtTokenHuman(event.tokenUsage.total)}`, query)}</span>` : ""}
  <span class="log-row-meta">${helpers.highlightMatch(toolOrExtra || "-", query)}</span>
  ${hasExpandable ? '<button class="log-row-expand" data-expand="true" type="button">▸</button>' : ""}
</article>`;
          })
          .join("");

        if (els.rows) {
          els.rows.innerHTML = `<div class="virtual-spacer" style="height:${slice.totalHeight}px;"></div>
    <div class="virtual-window" style="transform:translateY(${slice.offsetTop}px)">${html}</div>`;
        }
        if (els.loadMoreBtn) {
          els.loadMoreBtn.hidden = !state.hasMore;
          els.loadMoreBtn.textContent = state.hasMore
            ? `加载更多 (${(state.filtered || []).length}/${callbacks.isServerMode() ? state.totalMatching : (state.filtered || []).length})`
            : "已全部加载";
        }
        controller.renderStats();
      },

      renderRows() {
        if (!(state.filtered || []).length) {
          state.selectedRowIndex = -1;
        }
        controller.renderVirtualRows();
      },

      getVirtualSessionSlice() {
        const total = (state.sessionGroups || []).length;
        const rowHeight = helpers.sessionRowHeightForDensity();
        const viewportHeight = els.sessionList?.clientHeight || state.sessionViewportHeight || 640;
        const overscan = 5;
        const start = Math.max(0, Math.floor((state.sessionScrollTop || 0) / rowHeight) - overscan);
        const visibleCount = Math.ceil(viewportHeight / rowHeight) + overscan * 2;
        const end = Math.min(total, start + visibleCount);
        return {
          total,
          rowHeight,
          start,
          end,
          offsetTop: start * rowHeight,
          totalHeight: total * rowHeight,
        };
      },

      sessionItemHtml(group) {
        const active = group.sessionId === state.selectedSessionId ? "active" : "";
        const title = group.sessionTitle || group.fallbackTitle || "未命名会话";
        const tokenMeta = helpers.hasTokenUsageData(group.aggregateToken)
          ? `Tok ${helpers.fmtTokenHuman(group.aggregateToken.total)}`
          : "Tok -";
        const compactMeta = `${group.count} · ${tokenMeta} · ${helpers.formatShanghaiTime(group.latest)}`;
        const platform = group.sourceType || "unknown";
        const platformLabel = platform === "claude" ? "CC" : platform === "codex" ? "CX" : platform;
        const platformFullName = platform === "claude" ? "Claude Code" : platform === "codex" ? "Codex" : platform;
        return `<li class="session-row">
    <div class="session-item ${active}" data-session-id="${helpers.escapeHtml(group.sessionId)}" role="button" tabindex="0">
      <div class="session-title-row">
        <span class="session-icon session-icon-${helpers.escapeHtml(platform)}" title="${helpers.escapeHtml(platformFullName)}">${helpers.escapeHtml(platformLabel)}</span>
        <span class="sname has-tip" data-tip="${helpers.escapeHtml(title)}">${helpers.escapeHtml(title)}</span>
        <span class="session-meta">${helpers.escapeHtml(compactMeta)}</span>
        <button class="session-copy-btn" data-copy-session-id="${helpers.escapeHtml(group.sessionId)}" type="button" title="复制 Session ID">⎘</button>
      </div>
      <div class="session-detail-row">
        <span class="sid">${helpers.escapeHtml(helpers.shortId(group.sessionId, 12))}</span>
        <span class="cwd-line">${helpers.escapeHtml(helpers.shortPathN(group.cwd, 3))}</span>
      </div>
    </div>
  </li>`;
      },

      renderVirtualSessionGroups() {
        if (!(state.sessionGroups || []).length) {
          if (els.sessionList) {
            els.sessionList.innerHTML = '<li class="session-empty">暂无 Session</li>';
            els.sessionList.scrollTop = 0;
          }
          state.sessionScrollTop = 0;
          state.sessionViewportHeight = els.sessionList?.clientHeight || 0;
          return;
        }

        state.sessionRowHeight = helpers.sessionRowHeightForDensity();
        state.sessionViewportHeight = els.sessionList?.clientHeight || state.sessionViewportHeight || 640;
        const slice = controller.getVirtualSessionSlice();
        const html = (state.sessionGroups || [])
          .slice(slice.start, slice.end)
          .map((group) => controller.sessionItemHtml(group))
          .join("");
        if (els.sessionList) {
          els.sessionList.innerHTML = `<div class="session-virtual-spacer" style="height:${slice.totalHeight}px;"></div>
    <div class="session-virtual-window" style="transform:translateY(${slice.offsetTop}px)">${html}</div>`;
        }
      },

      refreshFiltersMeta() {
        const currentModel = els.modelSelect?.value || "";
        const currentType = els.typeSelect?.value || "";
        const currentPlatform = els.platformSelect?.value || "";
        const sourceMeta = callbacks.isServerMode()
          ? state.meta || { models: [], types: [], platforms: [] }
          : core.collectMeta((state.events || []).filter(callbacks.isVisibleInCurrentMode));
        const models = sourceMeta.models || [];
        const types = sourceMeta.types || [];
        const platforms = sourceMeta.platforms || [];

        if (els.modelSelect) {
          els.modelSelect.innerHTML = `<option value="">全部</option>${models
            .map((model) => `<option value="${helpers.escapeHtml(model)}">${helpers.escapeHtml(model)}</option>`)
            .join("")}`;
          els.modelSelect.value = models.includes(currentModel) ? currentModel : "";
        }
        if (els.typeSelect) {
          els.typeSelect.innerHTML = `<option value="">全部</option>${types
            .map((type) => `<option value="${helpers.escapeHtml(type)}">${helpers.escapeHtml(type)}</option>`)
            .join("")}`;
          els.typeSelect.value = types.includes(currentType) ? currentType : "";
        }
        if (els.platformSelect) {
          els.platformSelect.innerHTML = `<option value="">全部</option>${platforms
            .map((platform) => `<option value="${helpers.escapeHtml(platform)}">${helpers.escapeHtml(platform)}</option>`)
            .join("")}`;
          els.platformSelect.value = platforms.includes(currentPlatform) ? currentPlatform : "";
        }
      },

      renderSessionGroups() {
        if (callbacks.isServerMode()) {
          state.sessionGroups = state.sessions;
          controller.renderVirtualSessionGroups();
          return;
        }
        const visibleEvents = (state.events || []).filter(callbacks.isVisibleInCurrentMode);
        if (!visibleEvents.length) {
          state.sessionGroups = [];
          if (els.sessionList) {
            els.sessionList.innerHTML = '<li class="session-empty">暂无 Session</li>';
          }
          return;
        }
        state.sessionGroups = core.buildSessionGroups(visibleEvents);
        controller.renderVirtualSessionGroups();
      },

      renderQuickFilterUi() {
        const buttons = els.quickFilters?.querySelectorAll?.("button[data-quick-filter]") || [];
        buttons.forEach((button) => {
          button.classList?.toggle?.("active", button.dataset?.quickFilter === state.quickFilter);
        });
      },
    };

    return controller;
  }

  return {
    createStreamUiController,
  };
});
