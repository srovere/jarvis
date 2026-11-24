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
