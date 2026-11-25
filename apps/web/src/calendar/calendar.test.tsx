import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { App } from '@/app/app';
import { createTestRouter } from '@/app/router';
import { account, jsonBody, mockShell } from '@/test/fixtures';
import { server } from '@/test/server';

beforeEach(() => vi.useFakeTimers({ toFake: ['Date'], now: new Date('2026-11-25T12:00:00Z') })); // a Wednesday
afterEach(() => vi.useRealTimers());

const renderAt = () => render(<App router={createTestRouter(['/calendar'])} />);

function mockEvents() {
  const queries: { from: string | null; to: string | null }[] = [];
  server.use(
    http.get('/api/calendar/events', ({ request }) => {
      const u = new URL(request.url);
      queries.push({ from: u.searchParams.get('from'), to: u.searchParams.get('to') });
      return HttpResponse.json({
        events: [{ id: 'e1', title: '<external_content source="calendar">Planning</external_content>', start: '2026-11-24T10:00:00.000+00:00', end: '2026-11-24T11:00:00.000+00:00', allDay: false, attendees: [] }],
      });
    }),
  );
  return queries;
}

describe('Calendar week', () => {
  it('requests Monday to the next Monday (exclusive) and navigates weeks', async () => {
    mockShell();
    const queries = mockEvents();
    renderAt();
    expect(await screen.findByText('Planning')).toBeInTheDocument();
    expect(queries.at(-1)).toEqual({ from: '2026-11-23', to: '2026-11-30' });
    await userEvent.click(screen.getByRole('button', { name: 'Next week' }));
    await vi.waitFor(() => expect(queries.at(-1)).toEqual({ from: '2026-11-30', to: '2026-12-07' }));
    await userEvent.click(screen.getByRole('button', { name: 'Previous week' }));
    await userEvent.click(screen.getByRole('button', { name: 'Previous week' }));
    await vi.waitFor(() => expect(queries.at(-1)).toEqual({ from: '2026-11-16', to: '2026-11-23' }));
    await userEvent.click(screen.getByRole('button', { name: 'This week' }));
    await vi.waitFor(() => expect(queries.at(-1)).toEqual({ from: '2026-11-23', to: '2026-11-30' }));
  });

  it('uses the configured time zone to decide which week is current', async () => {
    // 2026-11-29 23:30 UTC is already Monday 2026-11-30 in Auckland.
    vi.setSystemTime(new Date('2026-11-29T23:30:00Z'));
    mockShell();
    server.use(http.get('/api/settings', () => HttpResponse.json({ zone: 'Pacific/Auckland', workSchedule: { startHour: 9, endHour: 19, workDays: [1] }, focus: { titlePrefix: '', horizonWorkDays: 5, defaultDurationMinutes: 90 }, sync: { intervalMinutes: 5, gmailInitialWindowDays: 90 }, briefing: { maxPriorityEmails: 10 } })));
    const queries = mockEvents();
    renderAt();
    await vi.waitFor(() => expect(queries.at(-1)).toEqual({ from: '2026-11-30', to: '2026-12-07' }));
  });
});

describe('Calendar actions', () => {
  it('finds a free slot and just shows it', async () => {
    mockShell();
    mockEvents();
    let body: unknown;
    server.use(
      http.post('/api/calendar/free-slot', async ({ request }) => {
        body = await jsonBody(request);
        return HttpResponse.json({ slot: { start: '2026-11-26T09:00:00.000+00:00', end: '2026-11-26T10:30:00.000+00:00' } });
      }),
    );
    renderAt();
    await userEvent.click(await screen.findByRole('button', { name: 'Find free slot' }));
    const dialog = await screen.findByRole('dialog');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Find' }));
    expect(await within(dialog).findByText('2026-11-26 09:00–10:30')).toBeInTheDocument();
    expect(body).toEqual({ durationMinutes: 90 });
  });

  it('blocks focus time only after the user confirms the proposed slot', async () => {
    mockShell();
    mockEvents();
    const posts: unknown[] = [];
    server.use(
      http.post('/api/calendar/free-slot', () => HttpResponse.json({ slot: { start: '2026-11-26T09:00:00.000+00:00', end: '2026-11-26T10:00:00.000+00:00' } })),
      http.post('/api/calendar/focus', async ({ request }) => {
        posts.push(await jsonBody(request));
        return HttpResponse.json({ status: 'created', start: '2026-11-26T09:00:00.000+00:00', end: '2026-11-26T10:00:00.000+00:00' });
      }),
    );
    renderAt();
    await userEvent.click(await screen.findByRole('button', { name: 'Block focus time' }));
    const dialog = await screen.findByRole('dialog');
    await userEvent.type(within(dialog).getByLabelText('Name'), 'Write report');
    await userEvent.clear(within(dialog).getByLabelText('Duration (minutes)'));
    await userEvent.type(within(dialog).getByLabelText('Duration (minutes)'), '60');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Find a slot' }));
    expect(await within(dialog).findByText('2026-11-26 09:00–10:00')).toBeInTheDocument();
    expect(posts).toEqual([]);
    await userEvent.click(within(dialog).getByRole('button', { name: 'Confirm and block' }));
    expect(await within(dialog).findByText(/Focus time blocked/)).toBeInTheDocument();
    expect(posts).toEqual([{ taskName: 'Write report', durationMinutes: 60, preferredStartHour: 9 }]);
  });
});

describe('Focus account choice', () => {
  it('offers the account selector with two active accounts and posts the choice', async () => {
    mockShell([account({ id: 'a1', email: 'a@example.com' }), account({ id: 'a2', email: 'b@example.com' })]);
    mockEvents();
    const posts: unknown[] = [];
    server.use(
      http.post('/api/calendar/free-slot', () => HttpResponse.json({ slot: { start: '2026-11-26T09:00:00.000+00:00', end: '2026-11-26T10:30:00.000+00:00' } })),
      http.post('/api/calendar/focus', async ({ request }) => {
        posts.push(await jsonBody(request));
        return HttpResponse.json({ status: 'created', start: '2026-11-26T09:00:00.000+00:00', end: '2026-11-26T10:30:00.000+00:00' });
      }),
    );
    renderAt();
    await userEvent.click(await screen.findByRole('button', { name: 'Block focus time' }));
    const dialog = await screen.findByRole('dialog');
    await userEvent.selectOptions(await within(dialog).findByRole('combobox', { name: 'Account' }), 'a2');
    await userEvent.type(within(dialog).getByLabelText('Name'), 'Deep work');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Find a slot' }));
    await within(dialog).findByText('2026-11-26 09:00–10:30');
    expect(within(dialog).getByText(/This will create a calendar event in b@example.com/)).toBeInTheDocument();
    await userEvent.click(within(dialog).getByRole('button', { name: 'Confirm and block' }));
    await within(dialog).findByText(/Focus time blocked/);
    expect(posts).toEqual([{ taskName: 'Deep work', durationMinutes: 90, preferredStartHour: 9, accountId: 'a2' }]);
  });

  it('shows no selector with a single account', async () => {
    mockShell();
    mockEvents();
    renderAt();
    await userEvent.click(await screen.findByRole('button', { name: 'Block focus time' }));
    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).queryByRole('combobox', { name: 'Account' })).not.toBeInTheDocument();
  });
});

describe('Focus confirmation is bound to the shown slot', () => {
  it('sends the shown slot hour and flags a different resulting slot', async () => {
    mockShell();
    mockEvents();
    const posts: unknown[] = [];
    server.use(
      http.post('/api/calendar/free-slot', () => HttpResponse.json({ slot: { start: '2026-11-26T14:00:00.000+00:00', end: '2026-11-26T15:00:00.000+00:00' } })),
      http.post('/api/calendar/focus', async ({ request }) => {
        posts.push(await jsonBody(request));
        return HttpResponse.json({ status: 'created', start: '2026-11-25T14:00:00.000+00:00', end: '2026-11-25T15:00:00.000+00:00' });
      }),
    );
    renderAt();
    await userEvent.click(await screen.findByRole('button', { name: 'Block focus time' }));
    const dialog = await screen.findByRole('dialog');
    await userEvent.type(within(dialog).getByLabelText('Name'), 'Deep work');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Find a slot' }));
    await within(dialog).findByText('2026-11-26 14:00–15:00');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Confirm and block' }));
    expect(await within(dialog).findByText(/differs from the slot shown/)).toHaveTextContent('2026-11-26 14:00–15:00');
    expect(within(dialog).getByText(/Focus time blocked/)).toHaveTextContent('2026-11-25 14:00–15:00');
    expect(posts).toEqual([{ taskName: 'Deep work', durationMinutes: 90, preferredStartHour: 14 }]);
  });
});
