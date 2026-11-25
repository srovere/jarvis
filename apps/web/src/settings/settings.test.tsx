import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { beforeEach, describe, expect, it } from 'vitest';
import type { CalendarInfo } from '@/api/client';
import { App } from '@/app/app';
import { createTestRouter } from '@/app/router';
import { account, defaultPreferences, mockShell, ready } from '@/test/fixtures';
import { server } from '@/test/server';

const renderAt = (path: string) => render(<App router={createTestRouter([path])} />);
const empty = () => new HttpResponse(null, { status: 204 });
const cal = (over: Partial<CalendarInfo>): CalendarInfo => ({ accountId: 'a1', id: 'primary', title: 'me@example.com', primary: true, busy: true, ...over });

function mockDelete() {
  const calls: { url: string; body: unknown }[] = [];
  server.use(
    http.delete('/api/accounts/:id', async ({ request }) => (calls.push({ url: request.url, body: await request.json() }), empty())),
  );
  return calls;
}

describe('settings routing', () => {
  it('/settings redirects to accounts', async () => {
    mockShell();
    renderAt('/settings');
    expect(await screen.findByRole('heading', { level: 2, name: 'Accounts' })).toBeInTheDocument();
  });
});

describe('settings accounts', () => {
  it('shows status, detail and the missing-scope hint', async () => {
    mockShell([
      account({ missingScopes: ['https://www.googleapis.com/auth/calendar.calendarlist.readonly'] }),
      account({ id: 'a2', email: 'old@example.com', status: 'needs_reauth', statusDetail: 'token revoked' }),
    ]);
    renderAt('/settings/accounts');
    expect(await screen.findByText('Reconnect to grant calendar list access')).toBeInTheDocument();
    expect(screen.getByText('needs_reauth')).toBeInTheDocument();
    expect(screen.getByText('token revoked')).toBeInTheDocument();
    expect(screen.getAllByRole('link', { name: 'Reconnect' })[0]).toHaveAttribute('href', '/api/oauth/google/start?returnTo=/settings/accounts');
    expect(screen.getByRole('link', { name: 'Add account' })).toHaveAttribute('href', '/api/oauth/google/start?returnTo=/settings/accounts');
  });

  it('shows the callback error and success', async () => {
    mockShell();
    renderAt('/settings/accounts?error=Consent%20was%20denied');
    expect(await screen.findByRole('alert')).toHaveTextContent('Consent was denied');
  });

  it('shows connected', async () => {
    mockShell();
    renderAt('/settings/accounts?connected=a1');
    expect(await screen.findByText('Account connected.')).toBeInTheDocument();
  });

  it('removes without deleting data by default', async () => {
    mockShell();
    const calls = mockDelete();
    renderAt('/settings/accounts');
    await userEvent.click(await screen.findByRole('button', { name: 'Remove me@example.com' }));
    const dialog = screen.getByRole('dialog');
    expect(within(dialog).getByRole('checkbox', { name: 'Also delete synced data' })).not.toBeChecked();
    await userEvent.click(within(dialog).getByRole('button', { name: 'Remove account' }));
    await waitFor(() => expect(calls).toHaveLength(1));
    expect(calls[0]!.url).toMatch(/\/api\/accounts\/a1\?deleteData=false$/);
    expect(calls[0]!.body).toEqual({});
  });

  it('removes and deletes synced data when checked, then refreshes setup status', async () => {
    mockShell();
    const calls = mockDelete();
    let setupCalls = 0;
    server.use(http.get('/api/setup/status', () => (setupCalls++, HttpResponse.json(ready))));
    renderAt('/settings/accounts');
    await userEvent.click(await screen.findByRole('button', { name: 'Remove me@example.com' }));
    await userEvent.click(screen.getByRole('checkbox', { name: 'Also delete synced data' }));
    const before = setupCalls;
    await userEvent.click(screen.getByRole('button', { name: 'Remove account' }));
    await waitFor(() => expect(calls).toHaveLength(1));
    expect(calls[0]!.url).toMatch(/\?deleteData=true$/);
    await waitFor(() => expect(setupCalls).toBeGreaterThan(before));
  });
});

describe('settings agent', () => {
  beforeEach(() => server.use(http.get('/api/providers', () => HttpResponse.json([{ kind: 'claude', label: 'Claude (subscription)' }]))));

  it('rejects an API key without sending any request', async () => {
    mockShell();
    const calls: string[] = [];
    server.use(
      http.put('/api/agent/token', () => (calls.push('token'), empty())),
      http.post('/api/agent/verify', () => (calls.push('verify'), HttpResponse.json({ ok: true }))),
    );
    renderAt('/settings/agent');
    await userEvent.type(await screen.findByLabelText('New Claude token'), 'sk-ant-api03-secret');
    await userEvent.click(screen.getByRole('button', { name: 'Replace token' }));
    expect(await screen.findByRole('alert')).toHaveTextContent(/API key/);
    expect(calls).toEqual([]);
  });

  it('replaces the token, verifies and never echoes it', async () => {
    mockShell();
    const sent: unknown[] = [];
    server.use(
      http.put('/api/agent/token', async ({ request }) => (sent.push(await request.json()), empty())),
      http.post('/api/agent/verify', () => HttpResponse.json({ ok: true, latencyMs: 321 })),
    );
    renderAt('/settings/agent');
    await userEvent.type(await screen.findByLabelText('New Claude token'), 'sk-ant-oat01-abc');
    await userEvent.click(screen.getByRole('button', { name: 'Replace token' }));
    expect(await screen.findByText(/Connected — 321 ms/)).toBeInTheDocument();
    expect(sent).toEqual([{ kind: 'claude', token: 'sk-ant-oat01-abc' }]);
    expect(document.body.textContent).not.toContain('sk-ant-oat01-abc');
  });

  it('Verify checks the stored token and shows failures', async () => {
    mockShell();
    server.use(http.post('/api/agent/verify', () => HttpResponse.json({ ok: false, reason: 'token expired' })));
    renderAt('/settings/agent');
    await userEvent.click(await screen.findByRole('button', { name: 'Verify' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('token expired');
  });

  it('hints to connect the agent when none is set', async () => {
    mockShell();
    server.use(http.get('/api/setup/status', () => HttpResponse.json({ ...ready, agent: 'skipped' })));
    renderAt('/settings/agent');
    expect(await screen.findByText('Connect your AI agent')).toBeInTheDocument();
  });
});

describe('settings preferences', () => {
  it('saves the exact settings body and changed busy calendars', async () => {
    mockShell();
    const saved: { settings: unknown[]; calendars: { id: string; body: unknown }[] } = { settings: [], calendars: [] };
    server.use(
      http.get('/api/calendar/calendars', () => HttpResponse.json({ calendars: [cal({}), cal({ id: 'work@example.com', title: 'Work', primary: false, busy: false })] })),
      http.put('/api/settings', async ({ request }) => (saved.settings.push(await request.json()), empty())),
      http.put('/api/accounts/:id/calendars', async ({ request, params }) => (saved.calendars.push({ id: String(params.id), body: await request.json() }), empty())),
    );
    renderAt('/settings/preferences');
    const to = await screen.findByLabelText('To');
    await userEvent.clear(to);
    await userEvent.type(to, '20');
    await userEvent.click(screen.getByRole('checkbox', { name: 'Work' }));
    await userEvent.click(screen.getByRole('button', { name: 'Save' }));
    expect(await screen.findByRole('status')).toHaveTextContent('Saved');
    expect(saved.settings).toEqual([{ ...defaultPreferences, workSchedule: { startHour: 9, endHour: 20, workDays: [1, 2, 3, 4, 5] } }]);
    expect(saved.calendars).toEqual([{ id: 'a1', body: { ids: ['primary', 'work@example.com'] } }]);
  });

  it('shows the API error on failure', async () => {
    mockShell();
    server.use(
      http.get('/api/calendar/calendars', () => HttpResponse.json({ calendars: [cal({})] })),
      http.put('/api/settings', () => HttpResponse.json({ error: 'Invalid time zone' }, { status: 400 })),
    );
    renderAt('/settings/preferences');
    await userEvent.click(await screen.findByRole('button', { name: 'Save' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Invalid time zone');
  });
});
