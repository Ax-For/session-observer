import type { Event, Session } from '../types';
import type { AppState } from './types';

export type AppAction =
  | { type: 'SET_EVENTS'; payload: { events: Event[]; sessions: Session[]; meta: AppState['meta']; claudeVersion: string; codexVersion: string; totalVisible: number; totalMatching: number; hasMore: boolean } }
  | { type: 'SET_FILTERED'; payload: Event[] }
  | { type: 'SET_THEME'; payload: 'light' | 'dark' }
  | { type: 'SET_DENSITY'; payload: 'cozy' | 'compact' }
  | { type: 'SET_VIEW_MODE'; payload: 'observe' | 'raw' }
  | { type: 'SET_QUICK_FILTER'; payload: 'all' | 'alert' | 'high_token' }
  | { type: 'SET_ACTIVE_TAB'; payload: 'stream' | 'sessions' }
  | { type: 'SET_SELECTED_SESSION'; payload: string }
  | { type: 'SET_SELECTED_ROW'; payload: number }
  | { type: 'SET_FILTER_PANEL'; payload: boolean }
  | { type: 'SET_DASHBOARD_COLLAPSED'; payload: boolean }
  | { type: 'SET_SESSION_PANE_WIDTH'; payload: number }
  | { type: 'SET_AUTO_REFRESH'; payload: boolean }
  | { type: 'SET_SESSION_MGMT_DATA'; payload: Record<string, Session[]> | null }
  | { type: 'TOGGLE_SESSION_SELECT'; payload: string }
  | { type: 'SET_ALL_SESSIONS_SELECTED'; payload: boolean }
  | { type: 'SET_DETAIL_MODAL'; payload: { event: Event | null; index: number } }
  | { type: 'SET_INLINE_CONV'; payload: { sessionId: string | null; open: boolean } }
  | { type: 'APPEND_EVENTS'; payload: { events: Event[]; hasMore: boolean; offset: number } }
  | { type: 'SET_LOCAL_EVENTS'; payload: Event[] }
  | { type: 'SET_DATA_SOURCE'; payload: 'server' | 'local' }
  | { type: 'RESET_STATE' };

export function appReducer(state: AppState, action: AppAction): AppState {
  switch (action.type) {
    case 'SET_EVENTS':
      return {
        ...state,
        events: action.payload.events,
        sessions: action.payload.sessions,
        meta: action.payload.meta,
        claudeVersion: action.payload.claudeVersion,
        codexVersion: action.payload.codexVersion,
        totalVisible: action.payload.totalVisible,
        totalMatching: action.payload.totalMatching,
        hasMore: action.payload.hasMore,
        pageOffset: 0,
        filtered: action.payload.events,
      };

    case 'SET_FILTERED':
      return { ...state, filtered: action.payload, selectedRowIndex: -1 };

    case 'SET_THEME': {
      localStorage.setItem('so-theme', action.payload);
      return { ...state, theme: action.payload };
    }

    case 'SET_DENSITY': {
      localStorage.setItem('so-density', action.payload);
      return { ...state, density: action.payload };
    }

    case 'SET_VIEW_MODE':
      return { ...state, viewMode: action.payload };

    case 'SET_QUICK_FILTER':
      return { ...state, quickFilter: action.payload };

    case 'SET_ACTIVE_TAB':
      return { ...state, activeTab: action.payload };

    case 'SET_SELECTED_SESSION':
      return { ...state, selectedSessionId: action.payload, selectedRowIndex: -1 };

    case 'SET_SELECTED_ROW':
      return { ...state, selectedRowIndex: action.payload };

    case 'SET_FILTER_PANEL':
      return { ...state, filterPanelOpen: action.payload };

    case 'SET_DASHBOARD_COLLAPSED':
      return { ...state, dashboardCollapsed: action.payload };

    case 'SET_SESSION_PANE_WIDTH':
      return { ...state, sessionPaneWidth: action.payload };

    case 'SET_AUTO_REFRESH':
      return { ...state, autoRefreshEnabled: action.payload };

    case 'SET_SESSION_MGMT_DATA':
      return { ...state, sessionMgmtData: action.payload };

    case 'TOGGLE_SESSION_SELECT': {
      const newSet = new Set(state.selectedSessionIds);
      if (newSet.has(action.payload)) newSet.delete(action.payload);
      else newSet.add(action.payload);
      return { ...state, selectedSessionIds: newSet };
    }

    case 'SET_ALL_SESSIONS_SELECTED': {
      const allIds = state.sessions.map((s) => s.sessionId);
      return {
        ...state,
        selectedSessionIds: action.payload ? new Set(allIds) : new Set(),
      };
    }

    case 'SET_DETAIL_MODAL':
      return { ...state, detailModalEvent: action.payload.event, detailModalIndex: action.payload.index };

    case 'SET_INLINE_CONV':
      return { ...state, inlineConvSessionId: action.payload.sessionId, inlineConvPanelOpen: action.payload.open };

    case 'APPEND_EVENTS':
      return {
        ...state,
        events: [...state.events, ...action.payload.events],
        filtered: [...state.filtered, ...action.payload.events],
        hasMore: action.payload.hasMore,
        pageOffset: action.payload.offset,
      };

    case 'SET_LOCAL_EVENTS':
      return { ...state, localEvents: action.payload, events: action.payload, filtered: action.payload };

    case 'SET_DATA_SOURCE':
      return { ...state, dataSource: action.payload };

    case 'RESET_STATE':
      return { ...state, events: [], filtered: [], sessions: [], meta: { models: [], types: [], platforms: [] }, totalVisible: 0, totalMatching: 0, hasMore: false, pageOffset: 0, selectedSessionId: '', selectedRowIndex: -1 };

    default:
      return state;
  }
}
