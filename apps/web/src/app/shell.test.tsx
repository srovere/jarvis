import { act, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Account, SetupStatus } from '@/api/client';
import { server } from '@/test/server';
import { App } from './app';
import { createTestRouter } from './router';

const ready: SetupStatus = { accounts: 1, agent: 'connected', preferencesSaved: true, googleClient: 'present' };
const account = (over: Partial<Account>): Account => ({
  id: 'a1', provider: 'google', email: 'me@example.com', status: 'active', missingScopes: [], busyCalendars: ['primary'], ...over,
});

function mockApi(opts: { setup?: SetupStatus; accounts?: Account[]; lastSyncAt?: string | null } = {}) {
  const posts: { contentType: string | null; body: unknown }[] = [];
  server.use(
    http.get('/api/setup/status', () => HttpResponse.json(opts.setup ?? ready)),
    http.get('/api/accounts', () => HttpResponse.json(opts.accounts ?? [account({})])),
    http.get('/api/sync', () =>
      HttpResponse.json({
        accounts: [{ accountId: 'a1', email: 'me@example.com', status: 'active', lastSyncAt: opts.lastSyncAt ?? null, missingScopes: [] }],
      }),
    ),
    http.post('/api/sync', async ({ request }) => {
      posts.push({ contentType: request.headers.get('content-type'), body: await request.json() });
      return HttpResponse.json({ requested: ['a1'] });
    }),
  );
  return posts;
}

afterEach(() => vi.useRealTimers());

const renderAt = (path: string) => render(<App router={createTestRouter([path])} />);

describe('app shell', () => {
  it('redirects to onboarding when there are no accounts', async () => {
    mockApi({ setup: { ...ready, accounts: 0 } });
    renderAt('/');
    expect(await screen.findByRole('heading', { name: 'Onboarding' })).toBeInTheDocument();
  });

  it('redirects to onboarding when preferences are not saved', async () => {
    mockApi({ setup: { ...ready, preferencesSaved: false } });
    renderAt('/mail');
    expect(await screen.findByRole('heading', { name: 'Onboarding' })).toBeInTheDocument();
  });

  it('renders the nav and the Today placeholder once set up', async () => {
    mockApi();
    renderAt('/');
    expect(await screen.findByRole('heading', { name: 'Today' })).toBeInTheDocument();
    for (const name of ['Today', 'Mail', 'Calendar', 'Tasks', 'Settings']) {
      expect(screen.getByRole('link', { name })).toBeInTheDocument();
    }
    expect(screen.getByTestId('chat-region')).toBeEmptyDOMElement();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('shows a reconnect banner for accounts that need reauth', async () => {
    mockApi({ accounts: [account({}), account({ id: 'a2', email: 'old@example.com', status: 'needs_reauth' })] });
    renderAt('/');
    const banner = await screen.findByRole('alert');
    expect(banner).toHaveTextContent('old@example.com');
    expect(banner).not.toHaveTextContent('me@example.com');
    expect(screen.getByRole('link', { name: 'Reconnect' })).toHaveAttribute(
      'href',
      '/api/oauth/google/start?returnTo=/settings/accounts',
    );
  });

  it('shows how long ago the latest sync happened', async () => {
    mockApi({ lastSyncAt: new Date(Date.now() - 5 * 60_000 - 1000).toISOString() });
    renderAt('/');
    expect(await screen.findByText('synced 5 min ago')).toBeInTheDocument();
  });

  it('shows "never synced" when nothing has synced', async () => {
    mockApi({ lastSyncAt: null });
    renderAt('/');
    expect(await screen.findByText('never synced')).toBeInTheDocument();
  });

  it('Sync now posts an empty JSON body', async () => {
    const posts = mockApi();
    renderAt('/');
    await userEvent.click(await screen.findByRole('button', { name: 'Sync now' }));
    await waitFor(() => expect(posts).toHaveLength(1));
    expect(posts[0]).toEqual({ contentType: 'application/json', body: {} });
  });

  it('advances the sync label as time passes, without new data', async () => {
    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval', 'Date'] });
    mockApi({ lastSyncAt: new Date(Date.now() - 1000).toISOString() });
    renderAt('/');
    expect(await screen.findByText('synced 0 min ago')).toBeInTheDocument();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(3 * 60_000);
    });
    expect(screen.getByText('synced 3 min ago')).toBeInTheDocument();
  });

  it('shows the server error when Sync now fails', async () => {
    mockApi();
    server.use(http.post('/api/sync', () => HttpResponse.json({ error: 'upstream unavailable' }, { status: 502 })));
    renderAt('/');
    await userEvent.click(await screen.findByRole('button', { name: 'Sync now' }));
    expect(await screen.findByRole('status')).toHaveTextContent('upstream unavailable');
  });

  it('lets the user retry when setup status fails to load', async () => {
    mockApi();
    let calls = 0;
    server.use(
      http.get('/api/setup/status', () => {
        calls += 1;
        return calls === 1 ? HttpResponse.json({ error: 'boom' }, { status: 500 }) : HttpResponse.json(ready);
      }),
    );
    renderAt('/');
    expect(await screen.findByRole('alert')).toHaveTextContent('boom');
    await userEvent.click(screen.getByRole('button', { name: 'Retry' }));
    expect(await screen.findByRole('heading', { name: 'Today' })).toBeInTheDocument();
  });
});
