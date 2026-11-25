export class ApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

/**
 * Calls the local API. The API requires `content-type: application/json` on every non-GET request,
 * so those always send JSON (`{}` when there is no body).
 */
export async function api<T>(path: string, init: { method?: string; body?: unknown } = {}): Promise<T> {
  const method = init.method ?? 'GET';
  const isGet = method === 'GET';
  const res = await fetch(path, {
    method,
    headers: isGet ? undefined : { 'content-type': 'application/json' },
    body: isGet ? undefined : JSON.stringify(init.body ?? {}),
  });
  if (!res.ok) {
    let message = `Request failed (${res.status})`;
    try {
      const data = (await res.json()) as { error?: string };
      if (data.error) message = data.error;
    } catch {
      // keep the generic message
    }
    throw new ApiError(res.status, message);
  }
  if (res.status === 204) return undefined as T;
  return (await res.json()) as T;
}

export interface SetupStatus {
  accounts: number;
  agent: 'connected' | 'failed' | 'skipped' | 'none';
  preferencesSaved: boolean;
  googleClient: 'present' | 'missing';
}

export interface Account {
  id: string;
  provider: string;
  email: string;
  status: 'active' | 'needs_reauth' | 'disabled';
  statusDetail?: string;
  missingScopes: string[];
  busyCalendars: string[];
}

export interface SyncStatus {
  accounts: {
    accountId: string;
    email: string;
    status: string;
    lastSyncAt: string | null;
    missingScopes: string[];
  }[];
}

export const getSetupStatus = () => api<SetupStatus>('/api/setup/status');
export const getAccounts = () => api<Account[]>('/api/accounts');
export const getSyncStatus = () => api<SyncStatus>('/api/sync');
export const triggerSync = () => api<{ requested: string[] }>('/api/sync', { method: 'POST' });

export const reconnectUrl = '/api/oauth/google/start?returnTo=/settings/accounts';

export interface Provider {
  kind: string;
  label: string;
}

/** The preferences the API stores (`GET/PUT /api/settings`); every field is required on save. */
export interface Preferences {
  zone: string;
  workSchedule: { startHour: number; endHour: number; workDays: number[] };
  focus: { titlePrefix: string; horizonWorkDays: number; defaultDurationMinutes: number };
  sync: { intervalMinutes: number; gmailInitialWindowDays: number };
  briefing: { maxPriorityEmails: number };
}

export interface CalendarInfo {
  accountId: string;
  id: string;
  /** Untrusted provider text, possibly wrapped in `<external_content>`: render through `plainText`. */
  title: string;
  primary: boolean;
  busy: boolean;
  missingScope?: true;
}

export const getProviders = (kind: 'mail' | 'agent') => api<Provider[]>(`/api/providers?kind=${kind}`);
export const uploadGoogleClient = (json: string) => api<void>('/api/google/client', { method: 'PUT', body: { json } });
export const getSettings = () => api<Preferences>('/api/settings');
export const putSettings = (preferences: Preferences) => api<void>('/api/settings', { method: 'PUT', body: preferences });
export const getCalendars = () => api<{ calendars: CalendarInfo[] }>('/api/calendar/calendars');
export const putAccountCalendars = (accountId: string, ids: string[]) =>
  api<void>(`/api/accounts/${encodeURIComponent(accountId)}/calendars`, { method: 'PUT', body: { ids } });
export const saveAgentToken = (kind: string, token: string) =>
  api<void>('/api/agent/token', { method: 'PUT', body: { kind, token } });
export const verifyAgent = (kind: string) =>
  api<{ ok: boolean; latencyMs?: number; reason?: string }>('/api/agent/verify', { method: 'POST', body: { kind } });
export const skipAgent = () => api<void>('/api/agent/skip', { method: 'POST' });

export const googleConnectUrl = '/api/oauth/google/start?returnTo=/onboarding';
