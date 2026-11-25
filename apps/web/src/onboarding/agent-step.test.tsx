import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { describe, expect, it } from 'vitest';
import { App } from '@/app/app';
import { createTestRouter } from '@/app/router';
import { account, defaultPreferences, fresh, mockOnboarding } from '@/test/fixtures';
import { server } from '@/test/server';

const renderAt = (path: string) => render(<App router={createTestRouter([path])} />);
const setup = { ...fresh, accounts: 1, googleClient: 'present' as const };

describe('agent step', () => {
  it('rejects an API key without sending any request', async () => {
    mockOnboarding({ setup, accounts: [account()] });
    const calls: string[] = [];
    server.use(
      http.put('/api/agent/token', () => (calls.push('token'), new HttpResponse(null, { status: 204 }))),
      http.post('/api/agent/verify', () => (calls.push('verify'), HttpResponse.json({ ok: true }))),
    );
    renderAt('/onboarding/agent');
    await userEvent.type(await screen.findByLabelText('Claude token'), 'sk-ant-api03-secret');
    await userEvent.click(screen.getByRole('button', { name: 'Verify' }));
    expect(await screen.findByRole('alert')).toHaveTextContent(/API key/);
    expect(calls).toEqual([]);
  });

  it('saves the token, verifies, shows latency and never echoes the token', async () => {
    mockOnboarding({ setup, accounts: [account()] });
    const sent: unknown[] = [];
    server.use(
      http.put('/api/agent/token', async ({ request }) => (sent.push(await request.json()), new HttpResponse(null, { status: 204 }))),
      http.post('/api/agent/verify', () => HttpResponse.json({ ok: true, latencyMs: 1234 })),
    );
    renderAt('/onboarding/agent');
    await userEvent.type(await screen.findByLabelText('Claude token'), 'sk-ant-oat01-abc');
    await userEvent.click(screen.getByRole('button', { name: 'Verify' }));
    expect(await screen.findByText(/Connected — 1234 ms/)).toBeInTheDocument();
    expect(sent).toEqual([{ kind: 'claude', token: 'sk-ant-oat01-abc' }]);
    expect(document.body.textContent).not.toContain('sk-ant-oat01-abc');
    expect(screen.getByLabelText('Claude token')).toHaveValue('');
    expect(screen.getByRole('link', { name: 'Continue' })).toHaveAttribute('href', '/onboarding/preferences');
  });

  it('shows the verification failure reason', async () => {
    mockOnboarding({ setup, accounts: [account()] });
    server.use(
      http.put('/api/agent/token', () => new HttpResponse(null, { status: 204 })),
      http.post('/api/agent/verify', () => HttpResponse.json({ ok: false, reason: 'token expired' })),
    );
    renderAt('/onboarding/agent');
    await userEvent.type(await screen.findByLabelText('Claude token'), 'sk-ant-oat01-abc');
    await userEvent.click(screen.getByRole('button', { name: 'Verify' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('token expired');
  });

  it('Skip for now posts skip and moves to preferences', async () => {
    mockOnboarding({ setup, accounts: [account()] });
    const skips: unknown[] = [];
    server.use(
      http.post('/api/agent/skip', async ({ request }) => (skips.push(await request.json()), new HttpResponse(null, { status: 204 }))),
      http.get('/api/settings', () => HttpResponse.json(defaultPreferences)),
      http.get('/api/calendar/calendars', () => HttpResponse.json({ calendars: [] })),
    );
    renderAt('/onboarding/agent');
    await userEvent.click(await screen.findByRole('button', { name: 'Skip for now' }));
    expect(await screen.findByRole('heading', { level: 2, name: 'Preferences' })).toBeInTheDocument();
    await waitFor(() => expect(skips).toEqual([{}]));
  });
});
