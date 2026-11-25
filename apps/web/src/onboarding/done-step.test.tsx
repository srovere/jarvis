import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { describe, expect, it } from 'vitest';
import { App } from '@/app/app';
import { createTestRouter } from '@/app/router';
import { account, mockOnboarding, ready } from '@/test/fixtures';
import { emptyToday } from '@/test/fixtures';
import { server } from '@/test/server';

describe('done step', () => {
  it('summarises the setup, shows first-sync progress and goes to the dashboard', async () => {
    mockOnboarding({ setup: ready, accounts: [account()] });
    server.use(
      http.get('/api/today', () => HttpResponse.json(emptyToday)),
      http.get('/api/settings', () => HttpResponse.json({ zone: 'UTC', workSchedule: { startHour: 9, endHour: 19, workDays: [1] } })),
      http.get('/api/sync', () =>
        HttpResponse.json({ accounts: [{ accountId: 'a1', email: 'me@example.com', status: 'active', lastSyncAt: null, missingScopes: [] }] }),
      ),
    );
    render(<App router={createTestRouter(['/onboarding/done'])} />);
    expect(await screen.findByText('me@example.com — syncing…')).toBeInTheDocument();
    expect(screen.getByText('Agent: connected')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Go to dashboard' }));
    expect(await screen.findByRole('heading', { name: 'Today' })).toBeInTheDocument();
  });
});
