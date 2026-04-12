import { useEffect, useRef, useCallback } from 'react';
import { useApp } from '../store/context';

interface UrlState {
  tab?: string;
  session?: string;
  q?: string;
  model?: string;
  type?: string;
  platform?: string;
  qf?: string;
  mode?: string;
  sort?: string;
  from?: string;
  to?: string;
  dash?: string;
  ar?: string;
}

const DEBOUNCE_MS = 150;
let timer: ReturnType<typeof setTimeout> | null = null;

function encodeStateToUrl(state: UrlState): string {
  const params = new URLSearchParams();
  if (state.tab && state.tab !== 'stream') params.set('tab', state.tab);
  if (state.session) params.set('session', state.session);
  if (state.q) params.set('q', state.q);
  if (state.model) params.set('model', state.model);
  if (state.type) params.set('type', state.type);
  if (state.platform) params.set('platform', state.platform);
  if (state.qf && state.qf !== 'all') params.set('qf', state.qf);
  if (state.mode && state.mode !== 'observe') params.set('mode', state.mode);
  if (state.sort && state.sort !== 'desc') params.set('sort', state.sort);
  if (state.from) params.set('from', state.from);
  if (state.to) params.set('to', state.to);
  if (state.dash) params.set('dash', state.dash);
  if (state.ar) params.set('ar', state.ar);
  return params.toString();
}

export function useUrlState() {
  const { state, dispatch } = useApp();
  const prevUrlRef = useRef('');

  // Decode URL on mount
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (!params.toString()) return;

    const tab = params.get('tab') || 'stream';
    const session = params.get('session') || '';
    const q = params.get('q') || '';
    const model = params.get('model') || '';
    const type = params.get('type') || '';
    const platform = params.get('platform') || '';
    const qf = (params.get('qf') as 'all' | 'alert' | 'high_token') || 'all';
    const mode = (params.get('mode') as 'observe' | 'raw') || 'observe';
    const sort = (params.get('sort') as 'asc' | 'desc') || 'desc';
    const dash = params.get('dash') === '1';
    const ar = params.get('ar') === '1';

    dispatch({ type: 'SET_ACTIVE_TAB', payload: tab as 'stream' | 'sessions' });
    if (session) dispatch({ type: 'SET_SELECTED_SESSION', payload: session });
    if (qf !== 'all') dispatch({ type: 'SET_QUICK_FILTER', payload: qf });
    if (mode !== 'observe') dispatch({ type: 'SET_VIEW_MODE', payload: mode });
    if (dash) dispatch({ type: 'SET_DASHBOARD_COLLAPSED', payload: true });
    if (ar) dispatch({ type: 'SET_AUTO_REFRESH', payload: true });

    // Set filter inputs after a tick
    requestAnimationFrame(() => {
      const searchInput = document.getElementById('filter-search') as HTMLInputElement;
      if (searchInput && q) searchInput.value = q;
      const modelSelect = document.getElementById('filter-model') as HTMLSelectElement;
      if (modelSelect && model) modelSelect.value = model;
      const typeSelect = document.getElementById('filter-type') as HTMLSelectElement;
      if (typeSelect && type) typeSelect.value = type;
      const platformSelect = document.getElementById('filter-platform') as HTMLSelectElement;
      if (platformSelect && platform) platformSelect.value = platform;
      const sortOrder = document.getElementById('filter-sort') as HTMLSelectElement;
      if (sortOrder) sortOrder.value = sort;
    });
  }, []);

  // Sync URL when state changes
  const syncUrl = useCallback(() => {
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => {
      const urlState: UrlState = {
        tab: state.activeTab !== 'stream' ? state.activeTab : undefined,
        session: state.selectedSessionId || undefined,
        qf: state.quickFilter !== 'all' ? state.quickFilter : undefined,
        mode: state.viewMode !== 'observe' ? state.viewMode : undefined,
        dash: state.dashboardCollapsed ? '1' : undefined,
        ar: state.autoRefreshEnabled ? '1' : undefined,
      };
      const newSearch = encodeStateToUrl(urlState);
      if (newSearch !== prevUrlRef.current) {
        const newUrl = newSearch ? `${window.location.pathname}?${newSearch}` : window.location.pathname;
        history.replaceState(null, '', newUrl);
        prevUrlRef.current = newSearch;
      }
    }, DEBOUNCE_MS);
  }, [state.activeTab, state.selectedSessionId, state.quickFilter, state.viewMode, state.dashboardCollapsed, state.autoRefreshEnabled]);

  useEffect(() => {
    syncUrl();
  }, [syncUrl]);
}
