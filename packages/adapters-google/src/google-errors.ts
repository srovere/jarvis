import { ReauthRequired } from '@jarvis/core';

interface ApiError {
  code?: unknown;
  status?: unknown;
  message?: unknown;
  response?: { status?: unknown; data?: { error?: unknown } };
}

const asApiError = (e: unknown): ApiError => (typeof e === 'object' && e !== null ? (e as ApiError) : {});

const hasStatus = (e: unknown, status: number): boolean => {
  const err = asApiError(e);
  return err.code === status || err.status === status || err.response?.status === status;
};

export const isNotFound = (e: unknown): boolean => hasStatus(e, 404);

/** 410: el cursor (`syncToken`) ya no es válido. */
export const isGone = (e: unknown): boolean => hasStatus(e, 410);

export function isInvalidGrant(e: unknown): boolean {
  const err = asApiError(e);
  return err.response?.data?.error === 'invalid_grant' || err.code === 'invalid_grant' || err.message === 'invalid_grant';
}

/** Desenvuelve `data` y traduce `invalid_grant` a `ReauthRequired`; el resto de errores se propaga. */
export async function callGoogle<T>(accountId: string, request: () => Promise<{ data: T }>): Promise<T> {
  try {
    return (await request()).data;
  } catch (e) {
    if (isInvalidGrant(e)) throw new ReauthRequired(accountId);
    throw e;
  }
}
