const state = {
  events: [],
  filtered: [],
  sessions: [],
  meta: { models: [], types: [] },
  totalVisible: 0,
  totalMatching: 0,
  pageOffset: 0,
  pageLimit: 250,
  hasMore: false,
  dataSource: "server",
  claudeVersion: "unknown",
  codexVersion: "unknown",
  selectedSessionId: "",
  selectedRowIndex: -1,
  quickFilter: "all",
  viewMode: "observe",
  autoRefreshEnabled: false,
  autoRefreshTimer: null,
  filterTimer: null,
  theme: "light",
  density: "cozy",
  dashboardCollapsed: false,
  sessionPaneWidth: 320,
  rowHeight: 156,
  scrollTop: 0,
  viewportHeight: 0,
  sessionGroups: [],
  sessionRowHeight: 152,
  sessionScrollTop: 0,
  sessionViewportHeight: 0,
  activeTab: "stream",
  sessionMgmtData: null,
  renameTargetSessionId: null,
  deleteTargetSessionId: null,
  fromSessionMgmt: false,
  lastViewedSessionId: null,
  selectedSessionIds: new Set(),
  batchConfirmAction: null,
  // Inline conversation panel state
  inlineConvEvents: [],
  inlineConvTotal: 0,
  inlineConvOffset: 0,
  inlineConvSessionId: null,
  inlineConvSessionInfo: null,
};

const ObserverCore = window.ObserverCore || {};
const ObserverData = window.ObserverData || {};
const ObserverApi = window.ObserverApi || {};
const ObserverSessionState = window.ObserverSessionState || {};
const ObserverDisplayUtils = window.ObserverDisplayUtils || {};
const ObserverStreamFilters = window.ObserverStreamFilters || {};
const ObserverUrlState = window.ObserverUrlState || {};
const ObserverAppShell = window.ObserverAppShell || {};
const ObserverSessionEvents = window.ObserverSessionEvents || {};
const ObserverStreamEvents = window.ObserverStreamEvents || {};
const ObserverStreamWorkspace = window.ObserverStreamWorkspace || {};
const ObserverSessionWorkspace = window.ObserverSessionWorkspace || {};
const ObserverStreamUi = window.ObserverStreamUi || {};
const ObserverSessionManagementView = window.ObserverSessionManagementView || {};
const ObserverConversationView = window.ObserverConversationView || {};
const coreAddTokenUsage = ObserverCore.addTokenUsage;
const coreBuildSessionGroups = ObserverCore.buildSessionGroups;
const coreCollectMeta = ObserverCore.collectMeta;
const coreEventMatchesMode = ObserverCore.eventMatchesMode;
const dataNormalizeRealtimePayload = ObserverData.normalizeRealtimePayload;
const dataParseFiles = ObserverData.parseFiles;
const apiClient = ObserverApi.createApiClient({ fetchImpl: window.fetch.bind(window) });
const sessionStateAreAllSelected = ObserverSessionState.areAllSelected;
const sessionStateBuildSelectedSessionList = ObserverSessionState.buildSelectedSessionList;
const sessionStateFilterSessionGroups = ObserverSessionState.filterSessionGroups;
const sessionStateGetAllSessionIds = ObserverSessionState.getAllSessionIds;
const sessionStateRemoveSessionsFromGroups = ObserverSessionState.removeSessionsFromGroups;
const sessionStateRenameSessionInGroups = ObserverSessionState.renameSessionInGroups;
const displayGetToolConfig = ObserverDisplayUtils.getToolConfig;
const displayDownloadJsonl = ObserverDisplayUtils.downloadJsonl;
const escapeHtml = ObserverDisplayUtils.escapeHtml;
const highlightMatch = ObserverDisplayUtils.highlightMatch;
const shortId = ObserverDisplayUtils.shortId;
const shortPathN = ObserverDisplayUtils.shortPathN;
const shortModel = ObserverDisplayUtils.shortModel;
const fmtNum = ObserverDisplayUtils.fmtNum;
const fmtTokenHuman = ObserverDisplayUtils.fmtTokenHuman;
const hasTokenUsageData = ObserverDisplayUtils.hasTokenUsageData;
const displayRowHeightForDensity = ObserverDisplayUtils.rowHeightForDensity;
const displaySessionRowHeightForDensity = ObserverDisplayUtils.sessionRowHeightForDensity;
const formatShanghaiTime = ObserverDisplayUtils.formatShanghaiTime;
const highlightJson = ObserverDisplayUtils.highlightJson;
const filterToDateMs = ObserverStreamFilters.toDateMs;
const matchStreamEvent = ObserverStreamFilters.matchStreamEvent;
const streamBuildDetailPayload = ObserverStreamWorkspace.buildDetailPayload;
const viewFindSessionById = ObserverSessionManagementView.findSessionById;
const viewRenderSessionDetailHtml = ObserverSessionManagementView.renderSessionDetailHtml;
const viewRenderSessionGroupsHtml = ObserverSessionManagementView.renderSessionGroupsHtml;
const viewRenderConversationHtml = ObserverConversationView.renderConversationHtml;

const els = {
  fileInput: document.getElementById("fileInput"),
  searchInput: document.getElementById("searchInput"),
  modelSelect: document.getElementById("modelSelect"),
  typeSelect: document.getElementById("typeSelect"),
  platformSelect: document.getElementById("platformSelect"),
  startTime: document.getElementById("startTime"),
  endTime: document.getElementById("endTime"),
  sortOrder: document.getElementById("sortOrder"),
  clearBtn: document.getElementById("clearBtn"),
  resetFiltersBtn: document.getElementById("resetFiltersBtn"),
  helpBtn: document.getElementById("helpBtn"),
  helpModal: document.getElementById("helpModal"),
  helpModalCloseBtn: document.getElementById("helpModalCloseBtn"),
  exportBtn: document.getElementById("exportBtn"),
  allSessionsBtn: document.getElementById("allSessionsBtn"),
  sessionList: document.getElementById("sessionList"),
  manualRefreshBtn: document.getElementById("manualRefreshBtn"),
  autoRefreshBtn: document.getElementById("autoRefreshBtn"),
  modeToggleBtn: document.getElementById("modeToggleBtn"),
  themeToggleBtn: document.getElementById("themeToggleBtn"),
  densityToggleBtn: document.getElementById("densityToggleBtn"),
  dashCollapseBtn: document.getElementById("dashCollapseBtn"),
  dashGrid: document.getElementById("dashGrid"),
  resizeHandle: document.getElementById("resizeHandle"),
  realtimeStatus: document.getElementById("realtimeStatus"),
  quickFilters: document.getElementById("quickFilters"),
  filterToggleBtn: document.getElementById("filterToggleBtn"),
  tokenThresholdInput: document.getElementById("tokenThresholdInput"),
  rows: document.getElementById("rows"),
  loadMoreBtn: document.getElementById("loadMoreBtn"),
  detailModal: document.getElementById("detailModal"),
  modalJson: document.getElementById("modalJson"),
  modalCloseBtn: document.getElementById("modalCloseBtn"),
  copyJsonBtn: document.getElementById("copyJsonBtn"),
  prevEventBtn: document.getElementById("prevEventBtn"),
  nextEventBtn: document.getElementById("nextEventBtn"),
  stats: document.getElementById("stats"),
  streamView: document.getElementById("streamView"),
  sessionsView: document.getElementById("sessionsView"),
  streamFilters: document.getElementById("streamFilters"),
  statsSection: document.querySelector(".stats"),
  sessionMgmtSearch: document.getElementById("sessionMgmtSearch"),
  sessionMgmtPlatform: document.getElementById("sessionMgmtPlatform"),
  sessionMgmtNamedOnly: document.getElementById("sessionMgmtNamedOnly"),
  sessionMgmtRefreshBtn: document.getElementById("sessionMgmtRefreshBtn"),
  sessionGroups: document.getElementById("sessionGroups"),
  sessionDetailModal: document.getElementById("sessionDetailModal"),
  sessionDetailBody: document.getElementById("sessionDetailBody"),
  sessionDetailCloseBtn: document.getElementById("sessionDetailCloseBtn"),
  renameModal: document.getElementById("renameModal"),
  renameInput: document.getElementById("renameInput"),
  renameConfirmBtn: document.getElementById("renameConfirmBtn"),
  renameModalCloseBtn: document.getElementById("renameModalCloseBtn"),
  deleteModal: document.getElementById("deleteModal"),
  deleteMessage: document.getElementById("deleteMessage"),
  deleteConfirmBtn: document.getElementById("deleteConfirmBtn"),
  deleteModalCloseBtn: document.getElementById("deleteModalCloseBtn"),
  selectAllCheckbox: document.getElementById("selectAllCheckbox"),
  batchDeleteBtn: document.getElementById("batchDeleteBtn"),
  batchExportBtn: document.getElementById("batchExportBtn"),
  batchConfirmModal: document.getElementById("batchConfirmModal"),
  batchConfirmTitle: document.getElementById("batchConfirmTitle"),
  batchConfirmMessage: document.getElementById("batchConfirmMessage"),
  batchConfirmList: document.getElementById("batchConfirmList"),
  batchConfirmCloseBtn: document.getElementById("batchConfirmCloseBtn"),
  batchConfirmCancelBtn: document.getElementById("batchConfirmCancelBtn"),
  batchConfirmOkBtn: document.getElementById("batchConfirmOkBtn"),
  // Inline conversation panel elements
  inlineConvPanel: document.getElementById("inlineConvPanel"),
  inlineConvClose: document.getElementById("inlineConvClose"),
  inlineConvTitle: document.getElementById("inlineConvTitle"),
  inlineConvPlatform: document.getElementById("inlineConvPlatform"),
  inlineConvStats: document.getElementById("inlineConvStats"),
  inlineConvLoadStatus: document.getElementById("inlineConvLoadStatus"),
  inlineConvBody: document.getElementById("inlineConvBody"),
};

function isVisibleInCurrentMode(event) {
  return coreEventMatchesMode(event, state.viewMode);
}

function isServerMode() {
  return state.dataSource === "server";
}

const downloadJsonlFile = (jsonl, filename) =>
  displayDownloadJsonl(jsonl, filename, { blobCtor: Blob, documentRef: document, urlRef: URL });

const rowHeightForDensity = () => displayRowHeightForDensity(state.density);
const sessionRowHeightForDensity = () => displaySessionRowHeightForDensity(state.density);

function matchFilters(event) {
  return matchStreamEvent(event, {
    query: els.searchInput.value,
    model: els.modelSelect.value,
    type: els.typeSelect.value,
    platform: els.platformSelect?.value || "",
    start: els.startTime.value,
    end: els.endTime.value,
    selectedSessionId: state.selectedSessionId,
    quickFilter: state.quickFilter,
    tokenThreshold: Number(els.tokenThresholdInput?.value || 20000),
  }, {
    eventMatchesMode: isVisibleInCurrentMode,
  });
}

const streamUi = ObserverStreamUi.createStreamUiController({
  state,
  els,
  documentRef: document,
  core: {
    addTokenUsage: coreAddTokenUsage,
    buildSessionGroups: coreBuildSessionGroups,
    collectMeta: coreCollectMeta,
  },
  helpers: {
    escapeHtml,
    highlightMatch,
    shortId,
    shortPathN,
    shortModel,
    fmtNum,
    fmtTokenHuman,
    hasTokenUsageData,
    formatShanghaiTime,
    rowHeightForDensity,
    sessionRowHeightForDensity,
  },
  callbacks: {
    isVisibleInCurrentMode,
    isServerMode,
  },
});
const renderStats = streamUi.renderStats;
const renderVirtualRows = streamUi.renderVirtualRows;
const renderRows = streamUi.renderRows;
const renderVirtualSessionGroups = streamUi.renderVirtualSessionGroups;
const refreshFiltersMeta = streamUi.refreshFiltersMeta;
const renderSessionGroups = streamUi.renderSessionGroups;
const renderQuickFilterUi = streamUi.renderQuickFilterUi;

const urlState = ObserverUrlState.createUrlStateController({
  state,
  els,
  locationRef: window.location,
  historyRef: window.history,
});
const decodeStateFromUrl = urlState.decodeStateFromUrl;
const syncUrl = urlState.syncUrl;

const streamWorkspace = ObserverStreamWorkspace.createStreamWorkspaceController({
  state,
  els,
  apiClient,
  normalizeRealtimePayload: dataNormalizeRealtimePayload,
  helpers: {
    formatShanghaiTime,
    highlightJson,
    toDateMs: filterToDateMs,
  },
  callbacks: {
    syncUrl,
    renderRows,
    refreshFiltersMeta,
    renderSessionGroups,
    matchFilters,
    isServerMode,
    setStatus(message) {
      els.realtimeStatus.textContent = message;
    },
    eventMatchesMode: coreEventMatchesMode,
  },
});

const applyFilters = streamWorkspace.applyFilters;
const scheduleApplyFilters = streamWorkspace.scheduleApplyFilters;
const showDetail = streamWorkspace.showDetail;
const closeModal = streamWorkspace.closeModal;
const setAutoRefreshUi = streamWorkspace.setAutoRefreshUi;
const setStatus = streamWorkspace.setStatus;
const loadRealtimeEventsPage = streamWorkspace.loadRealtimeEventsPage;
const refreshOnce = streamWorkspace.refreshOnce;
const startAutoRefresh = streamWorkspace.startAutoRefresh;
const stopAutoRefresh = streamWorkspace.stopAutoRefresh;

const sessionWorkspace = ObserverSessionWorkspace.createSessionWorkspaceController({
  state,
  els,
  apiClient,
  sessionState: {
    filterSessionGroups: sessionStateFilterSessionGroups,
    getAllSessionIds: sessionStateGetAllSessionIds,
    areAllSelected: sessionStateAreAllSelected,
    buildSelectedSessionList: sessionStateBuildSelectedSessionList,
    renameSessionInGroups: sessionStateRenameSessionInGroups,
    removeSessionsFromGroups: sessionStateRemoveSessionsFromGroups,
  },
  views: {
    findSessionById: viewFindSessionById,
    renderSessionDetailHtml: viewRenderSessionDetailHtml,
    renderSessionGroupsHtml: viewRenderSessionGroupsHtml,
    renderConversationHtml: viewRenderConversationHtml,
  },
  helpers: {
    escapeHtml,
    fmtTokenHuman,
    formatShanghaiTime,
    hasTokenUsageData,
    shortId,
    shortPathN,
    fmtNum,
    getToolConfig: displayGetToolConfig,
    highlightJson,
  },
  callbacks: {
    syncUrl,
    setStatus,
    applyFilters,
    renderSessionGroups,
    downloadJsonl: downloadJsonlFile,
    logError: console.error.bind(console),
  },
});

const switchTab = sessionWorkspace.switchTab;
const loadSessionMgmtData = sessionWorkspace.loadSessionMgmtData;
const renderSessionMgmtView = sessionWorkspace.renderSessionMgmtView;
const closeSessionDetail = sessionWorkspace.closeSessionDetail;
const copySessionId = sessionWorkspace.copySessionId;
const openInlineConversation = sessionWorkspace.openInlineConversation;
const closeInlineConversation = sessionWorkspace.closeInlineConversation;
const openRenameModal = sessionWorkspace.openRenameModal;
const closeRenameModal = sessionWorkspace.closeRenameModal;
const confirmRename = sessionWorkspace.confirmRename;
const openDeleteModal = sessionWorkspace.openDeleteModal;
const closeDeleteModal = sessionWorkspace.closeDeleteModal;
const confirmDelete = sessionWorkspace.confirmDelete;
const navigateToSessionEvents = sessionWorkspace.navigateToSessionEvents;
const goBackToSessionMgmt = sessionWorkspace.goBackToSessionMgmt;
const toggleSessionSelection = sessionWorkspace.toggleSessionSelection;
const toggleSelectAll = sessionWorkspace.toggleSelectAll;
const openBatchDeleteConfirm = sessionWorkspace.openBatchDeleteConfirm;
const openBatchExportConfirm = sessionWorkspace.openBatchExportConfirm;
const closeBatchConfirmModal = sessionWorkspace.closeBatchConfirmModal;
const confirmBatchAction = sessionWorkspace.confirmBatchAction;

let appShell = null;

const sessionEvents = ObserverSessionEvents.createSessionEventsController({
  state,
  els,
  documentRef: document,
  navigatorRef: navigator,
  callbacks: {
    switchTab: (tab) => switchTab(tab),
    renderSessionMgmtView,
    loadSessionMgmtData,
    toggleSelectAll,
    openBatchDeleteConfirm,
    openBatchExportConfirm,
    toggleSessionSelection,
    copySessionId,
    openInlineConversation,
    openRenameModal,
    openDeleteModal,
    navigateToSessionEvents,
    closeSessionDetail,
    closeInlineConversation,
    closeRenameModal,
    confirmRename,
    closeDeleteModal,
    confirmDelete,
    closeBatchConfirmModal,
    confirmBatchAction,
    setStatus,
  },
});

const streamEvents = ObserverStreamEvents.createStreamEventsController({
  state,
  els,
  parseFiles: dataParseFiles,
  storageRef: localStorage,
  documentRef: document,
  windowRef: window,
  navigatorRef: navigator,
  helpers: {
    buildDetailPayload(event) {
      return streamBuildDetailPayload(event, { formatShanghaiTime });
    },
    shortId,
    isServerMode,
    isVisibleInCurrentMode,
    rowHeightForDensity,
    downloadJsonl: downloadJsonlFile,
  },
  callbacks: {
    applyFilters,
    scheduleApplyFilters,
    showDetail,
    renderVirtualRows,
    renderVirtualSessionGroups,
    loadRealtimeEventsPage,
    setStatus,
    closeModal,
    closeSessionDetail,
    closeRenameModal,
    closeDeleteModal,
    refreshOnce,
    stopAutoRefresh,
    startAutoRefresh,
    applyViewMode: (mode) => appShell.applyViewMode(mode),
    applyTheme: (theme) => appShell.applyTheme(theme),
    applyDensity: (density) => appShell.applyDensity(density),
    refreshFiltersMeta,
    renderSessionGroups,
    renderQuickFilterUi,
    renderStats,
    syncUrl,
    goBackToSessionMgmt,
    renderRows,
  },
});

appShell = ObserverAppShell.createAppShellController({
  state,
  els,
  storageRef: localStorage,
  documentRef: document,
  windowRef: window,
  helpers: {
    rowHeightForDensity,
    sessionRowHeightForDensity,
  },
  callbacks: {
    syncUrl,
    wireEvents: () => streamEvents.wireEvents(),
    wireSessionMgmt: () => sessionEvents.wireSessionMgmt(),
    decodeStateFromUrl,
    renderQuickFilterUi,
    renderSessionGroups,
    renderStats,
    switchTab: (tab) => switchTab(tab),
    setAutoRefreshUi: (enabled) => setAutoRefreshUi(enabled),
    setStatus: (message) => setStatus(message),
    refreshOnce: (prefix) => refreshOnce(prefix),
    renderVirtualSessionGroups,
    renderVirtualRows,
  },
});

const startApp = appShell.startApp;

startApp();
