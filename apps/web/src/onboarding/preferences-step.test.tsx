import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { CalendarInfo } from '@/api/client';
import { App } from '@/app/app';
import { createTestRouter } from '@/app/router';
import { account, defaultPreferences, mockOnboarding, ready } from '@/test/fixtures';
import { server } from '@/test/server';

const renderAt = (path: string) => render(<App router={createTestRouter([path])} />);
const setup = { ...ready, preferencesSaved: false };
const empty = () => new HttpResponse(null, { status: 204 });

function mockPrefs(calendars: CalendarInfo[], accounts = [account()]) {
  mockOnboarding({ setup, accounts });
  const saved: { settings: unknown[]; calendars: { id: string; body: unknown }[] } = { settings: [], calendars: [] };
  server.use(
    http.get('/api/settings', () => HttpResponse.json(defaultPreferences)),
    http.get('/api/calendar/calendars', () => HttpResponse.json({ calendars })),
    http.put('/api/settings', async ({ request }) => (saved.settings.push(await request.json()), empty())),
    http.put('/api/accounts/:id/calendars', async ({ request, params }) => (saved.calendars.push({ id: String(params.id), body: await request.json() }), empty())),
    http.get('/api/sync', () => HttpResponse.json({ accounts: [] })),
  );
  return saved;
}

const cal = (over: Partial<CalendarInfo>): CalendarInfo => ({ accountId: 'a1', id: 'primary', title: 'me@example.com', primary: true, busy: true, ...over });

describe('preferences step', () => {
  afterEach(() => vi.restoreAllMocks());

  it('prefills the time zone from the browser and shows the labelled combobox', async () => {
    vi.spyOn(Intl.DateTimeFormat.prototype, 'resolvedOptions').mockReturnValue({ timeZone: 'America/Argentina/Buenos_Aires' } as Intl.ResolvedDateTimeFormatOptions);
    mockPrefs([cal({})]);
    renderAt('/onboarding/preferences');
    const zone = await screen.findByRole('combobox', { name: 'Time zone' });
    expect((zone as HTMLInputElement).value).toBe('Buenos Aires — America (UTC-03:00)');
  });

  it('searches time zones by typing', async () => {
    mockPrefs([cal({})]);
    renderAt('/onboarding/preferences');
    const zone = await screen.findByRole('combobox', { name: 'Time zone' });
    await userEvent.clear(zone);
    await userEvent.type(zone, 'buenos');
    const options = within(screen.getByRole('listbox')).getAllByRole('option');
    expect(options[0]).toHaveTextContent(/^Buenos Aires — America \(UTC-03:00\)$/);
  });

  it('submits the exact settings body (endHour 24 allowed) then the busy calendars, and goes to done', async () => {
    const saved = mockPrefs([cal({}), cal({ id: 'work@example.com', title: 'Work', primary: false, busy: false })]);
    renderAt('/onboarding/preferences');
    const zone = await screen.findByRole('combobox', { name: 'Time zone' });
    await userEvent.clear(zone);
    await userEvent.type(zone, 'madrid');
    await userEvent.click(screen.getByRole('option', { name: /Madrid/ }));
    const to = screen.getByLabelText('To');
    await userEvent.clear(to);
    await userEvent.type(to, '24');
    await userEvent.click(screen.getByRole('button', { name: 'Sat' }));
    await userEvent.click(screen.getByRole('checkbox', { name: 'Work' }));
    await userEvent.click(screen.getByRole('button', { name: 'Finish setup' }));

    expect(await screen.findByRole('heading', { level: 2, name: 'All set' })).toBeInTheDocument();
    expect(saved.settings).toEqual([
      {
        zone: 'Europe/Madrid',
        workSchedule: { startHour: 9, endHour: 24, workDays: [1, 2, 3, 4, 5, 6] },
        focus: { titlePrefix: '[Focus] ', horizonWorkDays: 5, defaultDurationMinutes: 90 },
        sync: { intervalMinutes: 5, gmailInitialWindowDays: 90 },
        briefing: { maxPriorityEmails: 10 },
      },
    ]);
    expect(saved.calendars).toEqual([{ id: 'a1', body: { ids: ['primary', 'work@example.com'] } }]);
  });

  it('drops a stored calendar id the list does not show once the user changes the selection', async () => {
    const saved = mockPrefs(
      [cal({}), cal({ id: 'work@example.com', title: 'Work', primary: false, busy: false })],
      [account({ busyCalendars: ['primary', 'me@example.com'] })],
    );
    renderAt('/onboarding/preferences');
    await userEvent.click(await screen.findByRole('checkbox', { name: 'Work' }));
    await userEvent.click(screen.getByRole('button', { name: 'Finish setup' }));
    await waitFor(() => expect(saved.calendars).toEqual([{ id: 'a1', body: { ids: ['primary', 'work@example.com'] } }]));
  });

  it('blocks submit with a message when start is not before end', async () => {
    const saved = mockPrefs([cal({})]);
    renderAt('/onboarding/preferences');
    const from = await screen.findByLabelText('From');
    await userEvent.clear(from);
    await userEvent.type(from, '20');
    await userEvent.click(screen.getByRole('button', { name: 'Finish setup' }));
    expect(await screen.findByRole('alert')).toHaveTextContent(/before/);
    expect(saved.settings).toEqual([]);
  });

  it('falls back to primary plus a manual id when the calendar list scope is missing', async () => {
    const saved = mockPrefs(
      [cal({ missingScope: true })],
      [account({ missingScopes: ['https://www.googleapis.com/auth/calendar.calendarlist.readonly'] })],
    );
    renderAt('/onboarding/preferences');
    expect(await screen.findByText('Reconnect to grant calendar list access')).toBeInTheDocument();
    expect(screen.getByRole('checkbox', { name: 'primary' })).toBeChecked();
    await userEvent.type(screen.getByLabelText('Additional calendar ids for me@example.com'), 'team@group.calendar.google.com, other@example.com');
    await userEvent.click(screen.getByRole('button', { name: 'Finish setup' }));
    await waitFor(() => expect(saved.calendars).toEqual([{ id: 'a1', body: { ids: ['primary', 'team@group.calendar.google.com', 'other@example.com'] } }]));
  });

  it('falls back the same way when the calendar list request fails', async () => {
    mockPrefs([]);
    server.use(http.get('/api/calendar/calendars', () => HttpResponse.json({ error: 'MCP server unavailable' }, { status: 502 })));
    renderAt('/onboarding/preferences');
    expect(await screen.findByLabelText('Additional calendar ids for me@example.com')).toBeInTheDocument();
  });
});
