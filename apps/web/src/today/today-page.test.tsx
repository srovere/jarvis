import { render, screen, within } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import { describe, expect, it } from 'vitest';
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
  emails: [{ threadId: 't9', from: '<external_content source="email">Ana</external_content>', subject: '<external_content source="email"><b>Budget</b></external_content>', date: '2026-11-25T08:00:00.000+00:00', snippet: 'hi' }],
  tasks: [{ id: 'k1', title: 'File taxes', due: '2026-11-25', list: 'My Tasks' }],
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
    expect(screen.getByRole('link', { name: /Budget/ })).toHaveAttribute('href', '/mail/a1/t9');
    expect(screen.getByRole('link', { name: /File taxes/ })).toHaveAttribute('href', '/tasks');
    expect(screen.getByRole('link', { name: /Standup/ })).toHaveAttribute('href', '/calendar');
  });
});
