import type { EventsResponse, SessionsResponse } from '../types';

const API_BASE = '/api';

async function fetchJson<T>(url: string, options?: RequestInit): Promise<T> {
  const res = await fetch(`${API_BASE}${url}`, options);
  if (!res.ok) throw new Error(`API error: ${res.status} ${res.statusText}`);
  return res.json() as Promise<T>;
}

export interface EventsParams {
  offset?: number;
  limit?: number;
  query?: string;
  model?: string;
  type?: string;
  platform?: string;
  sessionId?: string;
  startMs?: number | null;
  endMs?: number | null;
  order?: 'asc' | 'desc';
  mode?: 'observe' | 'raw';
  tokenThreshold?: number;
  quickFilter?: 'all' | 'alert' | 'high_token';
}

export const api = {
  async fetchEvents(params: EventsParams = {}): Promise<EventsResponse> {
    const search = new URLSearchParams();
    if (params.offset != null) search.set('offset', String(params.offset));
    if (params.limit != null) search.set('limit', String(params.limit));
    if (params.query) search.set('query', params.query);
    if (params.model) search.set('model', params.model);
    if (params.type) search.set('type', params.type);
    if (params.platform) search.set('platform', params.platform);
    if (params.sessionId) search.set('sessionId', params.sessionId);
    if (params.startMs != null) search.set('startMs', String(params.startMs));
    if (params.endMs != null) search.set('endMs', String(params.endMs));
    if (params.order) search.set('order', params.order);
    if (params.mode) search.set('mode', params.mode);
    if (params.tokenThreshold != null) search.set('tokenThreshold', String(params.tokenThreshold));
    if (params.quickFilter && params.quickFilter !== 'all') search.set('quickFilter', params.quickFilter);

    return fetchJson<EventsResponse>(`/events?${search.toString()}`);
  },

  async fetchSessions(): Promise<SessionsResponse> {
    return fetchJson<SessionsResponse>('/sessions');
  },

  async renameSession(sessionId: string, newName: string) {
    return fetchJson(`${API_BASE}/sessions/rename`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sessionId, newName }),
    });
  },

  async deleteSession(sessionId: string) {
    return fetchJson(`${API_BASE}/sessions/${sessionId}`, {
      method: 'DELETE',
    });
  },

  async batchDeleteSessions(sessionIds: string[]) {
    return fetchJson(`${API_BASE}/sessions/batch-delete`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sessionIds }),
    });
  },
};
