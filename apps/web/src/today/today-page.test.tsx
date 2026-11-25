import { render, screen, within } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import { describe, expect, it } from 'vitest';
import { freeGaps } from './today-page';
import { App } from '@/app/app';
import { createTestRouter } from '@/app/router';
import { mockShell } from '@/test/fixtures';
import { server } from '@/test/server';

const today = {
  date: '2026-11-25',
  cards: { meetings: 2, freeMinutes: 210, priorityEmails: 1, tasksDue: 3 },
  events: [
    { id: 'e1', title: '<external_content source="calendar">Standup</external_content>', start: '2026-11-25T09:30:00.000+00:00', end: '2026-11-25T10:00:00.000+00:00', allDay: false, attendees: [] },
    { id: 'e2', title: 'Review', start: '2026-11-25T15:00:00.000+00:00', end: '2026-11-25T16:00:00.000+00:00', allDay: false, attendees: [] },
  ],
  emails: [{ threadId: 't9', accountId: 'a2', from: '<external_content source="email">Ana</external_content>', subject: '<external_content source="email"><b>Budget</b></external_content>', date: '2026-11-25T08:00:00.000+00:00', snippet: 'hi' }],
  tasks: [{ id: 'k1', accountId: 'a1', title: 'File taxes', due: '2026-11-25', list: 'My Tasks' }],
};

describe('Today', () => {
  it('shows the four cards from the briefing and the three columns', async () => {
    mockShell();
    server.use(http.get('/api/today', () => HttpResponse.json(today)));
    render(<App router={createTestRouter(['/'])} />);
    const card = async (name: string) => within(await screen.findByRole('group', { name })).getByTestId('value');
    expect((await card('Meetings today')).textContent).toBe('2');
    expect((await card('Free hours')).textContent).toBe('3h 30m');
    expect((await card('Priority emails')).textContent).toBe('1');
    expect((await card('Tasks due')).textContent).toBe('3');
    expect(screen.getByRole('heading', { name: 'Agenda' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Priority emails' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Tasks due' })).toBeInTheDocument();
    // External content is plain text: wrapper stripped, markup not interpreted.
    expect(screen.getByText('Standup')).toBeInTheDocument();
    expect(screen.getByText('<b>Budget</b>')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /Budget/ })).toHaveAttribute('href', '/mail/a2/t9');
    expect(screen.getByRole('link', { name: /File taxes/ })).toHaveAttribute('href', '/tasks');
    expect(screen.getByRole('link', { name: /Standup/ })).toHaveAttribute('href', '/calendar');
  });
});

describe('freeGaps', () => {
  const ev = (start: string, end: string) => ({ id: start, title: 'x', start: `2026-11-25T${start}:00.000+00:00`, end: `2026-11-25T${end}:00.000+00:00`, allDay: false, attendees: [] });
  const events = [ev('10:00', '11:00'), ev('14:00', '15:00')];

  it('lists every gap in work hours when the day has not started', () => {
    expect(freeGaps(events, 9, 18, 0)).toEqual([{ start: 540, end: 600 }, { start: 660, end: 840 }, { start: 900, end: 1080 }]);
  });

  it('drops gaps that already ended and clips the one in progress to now', () => {
    // 11:30 now: the 09:00-10:00 gap is past, 11:00-14:00 starts at 11:30.
    expect(freeGaps(events, 9, 18, 690)).toEqual([{ start: 690, end: 840 }, { start: 900, end: 1080 }]);
  });
});
