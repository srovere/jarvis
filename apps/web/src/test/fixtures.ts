import { http, HttpResponse } from 'msw';
import type { Account, Preferences, SetupStatus } from '@/api/client';
import { server } from './server';

export const ready: SetupStatus = { accounts: 1, agent: 'connected', preferencesSaved: true, googleClient: 'present' };
export const fresh: SetupStatus = { accounts: 0, agent: 'none', preferencesSaved: false, googleClient: 'missing' };

export const account = (over: Partial<Account> = {}): Account => ({
  id: 'a1',
  provider: 'google',
  email: 'me@example.com',
  status: 'active',
  missingScopes: [],
  busyCalendars: ['primary'],
  ...over,
});

/** Handlers shared by tests that render the onboarding wizard. */
export function mockOnboarding(opts: { setup?: SetupStatus; accounts?: Account[] } = {}) {
  server.use(
    http.get('/api/setup/status', () => HttpResponse.json(opts.setup ?? fresh)),
    http.get('/api/accounts', () => HttpResponse.json(opts.accounts ?? [])),
    http.get('/api/providers', ({ request }) =>
      HttpResponse.json(
        new URL(request.url).searchParams.get('kind') === 'agent'
          ? [{ kind: 'claude', label: 'Claude (subscription)' }]
          : [{ kind: 'google', label: 'Google' }],
      ),
    ),
  );
}

export const defaultPreferences: Preferences = {
  zone: 'UTC',
  workSchedule: { startHour: 9, endHour: 19, workDays: [1, 2, 3, 4, 5] },
  focus: { titlePrefix: '[Focus] ', horizonWorkDays: 5, defaultDurationMinutes: 90 },
  sync: { intervalMinutes: 5, gmailInitialWindowDays: 90 },
  briefing: { maxPriorityEmails: 10 },
};

export const emptyToday = { date: '2026-11-25', cards: { meetings: 0, freeMinutes: 0, priorityEmails: 0, tasksDue: 0 }, events: [], emails: [], tasks: [], upcoming: [] };

/** Handlers the shell needs around any dashboard view (setup, accounts, sync status, settings). */
export function mockShell(accounts = [account()]) {
  server.use(
    http.get('/api/setup/status', () => HttpResponse.json(ready)),
    http.get('/api/accounts', () => HttpResponse.json(accounts)),
    http.get('/api/sync', () => HttpResponse.json({ accounts: [] })),
    http.get('/api/settings', () => HttpResponse.json(defaultPreferences)),
    http.get('/api/today', () => HttpResponse.json(emptyToday)),
  );
}

/** Parses the JSON body of a request seen by a test handler. */
export const jsonBody = async (request: Request) => (await request.json()) as unknown;
