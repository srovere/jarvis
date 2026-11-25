import { ApiError } from '@/api/client';

export const API_KEY_MESSAGE =
  'This looks like an Anthropic API key (sk-ant-api…). Jarvis never uses API keys: run `claude setup-token` and paste the subscription token it prints.';

export const messageOf = (e: unknown) => (e instanceof ApiError ? e.message : 'Something went wrong. Try again.');

/** Client-side check of a pasted agent token; returns an error message, or null when it may be sent. */
export function tokenProblem(value: string): string | null {
  if (value === '') return 'Paste the token first.';
  if (value.startsWith('sk-ant-api')) return API_KEY_MESSAGE;
  return null;
}
