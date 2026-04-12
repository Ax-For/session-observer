import type { Event, Session, DashboardStats } from '../types';

export type Theme = 'light' | 'dark';
export type Density = 'cozy' | 'compact';
export type ViewMode = 'observe' | 'raw';
export type QuickFilter = 'all' | 'alert' | 'high_token';
export type ActiveTab = 'stream' | 'sessions';
export type DataSource = 'server' | 'local';

export interface AppState {
  // Data
  events: Event[];
  filtered: Event[];
  sessions: Session[];
  meta: { models: string[]; types: string[]; platforms: string[] };
  claudeVersion: string;
  codexVersion: string;
  totalVisible: number;
  totalMatching: number;
  pageOffset: number;
  pageLimit: number;
  hasMore: boolean;
  dataSource: DataSource;

  // Selection
  selectedSessionId: string;
  selectedRowIndex: number;

  // Filters
  quickFilter: QuickFilter;
  viewMode: ViewMode;

  // UI State
  theme: Theme;
  density: Density;
  dashboardCollapsed: boolean;
  sessionPaneWidth: number;
  activeTab: ActiveTab;
  filterPanelOpen: boolean;

  // Session management
  sessionMgmtData: Record<string, Session[]> | null;
  selectedSessionIds: Set<string>;

  // Auto refresh
  autoRefreshEnabled: boolean;

  // Modal state
  detailModalEvent: Event | null;
  detailModalIndex: number;

  // Inline conversation
  inlineConvSessionId: string | null;
  inlineConvPanelOpen: boolean;

  // Local mode events
  localEvents: Event[];
}

export const initialState: AppState = {
  events: [],
  filtered: [],
  sessions: [],
  meta: { models: [], types: [], platforms: [] },
  claudeVersion: 'unknown',
  codexVersion: 'unknown',
  totalVisible: 0,
  totalMatching: 0,
  pageOffset: 0,
  pageLimit: 250,
  hasMore: false,
  dataSource: 'server',
  selectedSessionId: '',
  selectedRowIndex: -1,
  quickFilter: 'all',
  viewMode: 'observe',
  theme: (localStorage.getItem('so-theme') as Theme) || 'light',
  density: (localStorage.getItem('so-density') as Density) || 'cozy',
  dashboardCollapsed: false,
  sessionPaneWidth: 320,
  activeTab: 'stream',
  filterPanelOpen: false,
  sessionMgmtData: null,
  selectedSessionIds: new Set(),
  autoRefreshEnabled: false,
  detailModalEvent: null,
  detailModalIndex: -1,
  inlineConvSessionId: null,
  inlineConvPanelOpen: false,
  localEvents: [],
};
