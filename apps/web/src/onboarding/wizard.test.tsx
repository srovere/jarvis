import { render, screen, waitFor, within } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import { describe, expect, it } from 'vitest';
import { App } from '@/app/app';
import { createTestRouter } from '@/app/router';
import { account, defaultPreferences, emptyToday, fresh, mockOnboarding, ready } from '@/test/fixtures';
import { server } from '@/test/server';

const renderAt = (path: string) => render(<App router={createTestRouter([path])} />);
const heading = (name: string) => screen.findByRole('heading', { level: 2, name });

describe('onboarding wizard routing', () => {
  it('starts at the mail step when there are no accounts', async () => {
    mockOnboarding({ setup: fresh });
    renderAt('/onboarding');
    expect(await heading('Mail & Calendar')).toBeInTheDocument();
  });

  it('resumes at the agent step when an account exists but no agent is configured', async () => {
    mockOnboarding({ setup: { ...fresh, accounts: 1, googleClient: 'present' }, accounts: [account()] });
    renderAt('/onboarding');
    expect(await heading('AI agent')).toBeInTheDocument();
  });

  it('resumes at preferences when the agent step is done but preferences are not saved', async () => {
    mockOnboarding({ setup: { ...ready, preferencesSaved: false }, accounts: [account()] });
    server.use(http.get('/api/settings', () => HttpResponse.json(defaultPreferences)), http.get('/api/calendar/calendars', () => HttpResponse.json({ calendars: [] })));
    renderAt('/onboarding');
    expect(await heading('Preferences')).toBeInTheDocument();
  });

  it('redirects to the dashboard when setup is complete', async () => {
    mockOnboarding({ setup: ready, accounts: [account()] });
    server.use(
      http.get('/api/sync', () => HttpResponse.json({ accounts: [] })),
      http.get('/api/settings', () => HttpResponse.json(defaultPreferences)),
      http.get('/api/today', () => HttpResponse.json(emptyToday)),
    );
    renderAt('/onboarding');
    expect(await screen.findByRole('heading', { name: 'Today' })).toBeInTheDocument();
  });

  it('keeps /onboarding/done even though setup is complete', async () => {
    mockOnboarding({ setup: ready, accounts: [account()] });
    server.use(http.get('/api/sync', () => HttpResponse.json({ accounts: [] })));
    renderAt('/onboarding/done');
    expect(await heading('All set')).toBeInTheDocument();
  });

  it('keeps the query string when resolving to the mail step and shows the error', async () => {
    mockOnboarding({ setup: { ...fresh, googleClient: 'present' } });
    renderAt('/onboarding?error=Access%20was%20denied.');
    expect(await screen.findByRole('alert')).toHaveTextContent('Access was denied.');
  });

  it('marks steps done, current and pending in the step list', async () => {
    mockOnboarding({ setup: { ...fresh, accounts: 1, googleClient: 'present' }, accounts: [account()] });
    renderAt('/onboarding/agent');
    await heading('AI agent');
    const list = screen.getByRole('list', { name: 'Steps' });
    await waitFor(() => expect(within(list).getAllByRole('listitem')[0]).toHaveTextContent(/^✓/));
    const items = within(list).getAllByRole('listitem');
    expect(items.map((i) => i.textContent)).toEqual([
      expect.stringMatching(/^✓.*Mail & Calendar/),
      expect.stringMatching(/^●.*AI agent/),
      expect.stringMatching(/^○.*Preferences/),
      expect.stringMatching(/^○.*Done/),
    ]);
  });
});
