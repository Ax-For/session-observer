// Event from API
export interface Event {
  time: string;
  sessionId: string;
  model: string;
  turnId: string;
  callId: string;
  toolName: string;
  cwd: string;
  sessionTitle: string;
  extra: string;
  sourceFile: string;
  sourceType: 'codex' | 'claude' | 'unknown';
  callType: string;
  rawType: string;
  rawSubType: string;
  content: string;
  summary: string;
  tokenUsage?: TokenUsage;
  raw?: Record<string, unknown>;
}

export interface TokenUsage {
  input: number | null;
  output: number | null;
  total: number | null;
  cachedInput: number | null;
  reasoningOutput: number | null;
}

// Session from API
export interface Session {
  sessionId: string;
  sessionTitle: string;
  fallbackTitle: string;
  cwd: string;
  sourceType: string;
  count: number;
  latest: string;
  models: string[];
  aggregateToken: TokenUsage | null;
  prompt: number;
  agent: number;
  tool: number;
}

export interface SessionGroup {
  cwd: string;
  sessions: Session[];
}

// API response types
export interface EventsResponse {
  generatedAt: string;
  sessionsDir: string;
  mode: string;
  claudeVersion: string;
  codexVersion: string;
  index: {
    dirty: boolean;
    lastBuiltAt: string;
    lastError: string;
    aggregateKey: string;
    currentAggregateKey: string;
  };
  totalVisible: number;
  totalMatching: number;
  sessions: Session[];
  meta: {
    models: string[];
    types: string[];
    platforms: string[];
  };
  page: {
    offset: number;
    limit: number;
    hasMore: boolean;
  };
  events: Event[];
}

export interface SessionsResponse {
  generatedAt: string;
  total: number;
  groups: Record<string, Session[]>;
}

// Dashboard stats
export interface DashboardStats {
  tokenTotal: TokenUsage;
  typeCounts: Record<string, number>;
  modelCounts: Record<string, number>;
  platformCounts: {
    codex: { sessions: number; events: number; models: Set<string> };
    claude: { sessions: number; events: number; models: Set<string> };
  };
  totalVisible: number;
  totalMatching: number;
  sessionCount: number;
  loadedCount: number;
}
