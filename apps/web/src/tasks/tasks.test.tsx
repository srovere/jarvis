import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { App } from '@/app/app';
import { createTestRouter } from '@/app/router';
import { account, jsonBody, mockShell } from '@/test/fixtures';
import { server } from '@/test/server';

beforeEach(() => vi.useFakeTimers({ toFake: ['Date'], now: new Date('2026-11-25T12:00:00Z') }));
afterEach(() => vi.useRealTimers());

const open = [
  { id: 'k1', title: 'Old thing', due: '2026-11-20', list: 'My Tasks' },
  { id: 'k2', title: 'Today thing', due: '2026-11-25', list: 'My Tasks' },
  { id: 'k3', title: 'Someday', list: 'My Tasks' },
];
const lists = { lists: [{ accountId: 'a1', id: 'l1', title: '<external_content source="tasks">My Tasks</external_content>' }] };
const renderAt = () => render(<App router={createTestRouter(['/tasks'])} />);

function mockTasks(accounts = [account()]) {
  mockShell(accounts);
  const statuses: (string | null)[] = [];
  server.use(
    http.get('/api/tasks/lists', () => HttpResponse.json(lists)),
    http.get('/api/tasks', ({ request }) => {
      const s = new URL(request.url).searchParams.get('status');
      statuses.push(s);
      return HttpResponse.json({ tasks: s === 'completed' ? [{ id: 'k9', title: 'Done thing', list: 'My Tasks' }] : open });
    }),
  );
  return statuses;
}

describe('Tasks filters', () => {
  it('overdue shows only open tasks due before today (client side)', async () => {
    const statuses = mockTasks();
    renderAt();
    expect(await screen.findByText('Someday')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Overdue' }));
    expect(screen.getByText('Old thing')).toBeInTheDocument();
    expect(screen.queryByText('Today thing')).not.toBeInTheDocument();
    expect(screen.queryByText('Someday')).not.toBeInTheDocument();
    expect(new Set(statuses)).toEqual(new Set(['open']));
    await userEvent.click(screen.getByRole('button', { name: 'Completed' }));
    expect(await screen.findByText('Done thing')).toBeInTheDocument();
    expect(statuses).toContain('completed');
  });
});

describe('Complete task', () => {
  it('completes optimistically with the owning account', async () => {
    mockTasks();
    let url = '';
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    server.use(
      http.post('/api/tasks/:accountId/:taskId/complete', async ({ request }) => {
        url = new URL(request.url).pathname;
        await gate;
        return HttpResponse.json({ id: 'k2', title: 'Today thing', list: 'My Tasks' });
      }),
    );
    renderAt();
    await userEvent.click(await screen.findByRole('checkbox', { name: 'Complete Today thing' }));
    await waitFor(() => expect(screen.queryByText('Today thing')).not.toBeInTheDocument()); // gone before the server answers
    release();
    await waitFor(() => expect(url).toBe('/api/tasks/a1/k2/complete'));
  });

  it('rolls back and shows the error when completing fails', async () => {
    mockTasks();
    server.use(http.post('/api/tasks/:accountId/:taskId/complete', () => HttpResponse.json({ error: 'Google unavailable' }, { status: 502 })));
    renderAt();
    await userEvent.click(await screen.findByRole('checkbox', { name: 'Complete Today thing' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Google unavailable');
    expect(await screen.findByText('Today thing')).toBeInTheDocument();
  });
});

describe('Create task and account selector', () => {
  it('hides the account selector with one active account and posts the task', async () => {
    mockTasks();
    let body: unknown;
    server.use(http.post('/api/tasks', async ({ request }) => ((body = await jsonBody(request)), HttpResponse.json({ id: 'n', title: 'Buy milk', list: 'My Tasks' }))));
    renderAt();
    await userEvent.click(await screen.findByRole('button', { name: 'New task' }));
    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).queryByRole('combobox', { name: 'Account' })).not.toBeInTheDocument();
    await userEvent.type(within(dialog).getByLabelText('Title'), 'Buy milk');
    await userEvent.type(within(dialog).getByLabelText('Due date'), '2026-12-01');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Create' }));
    await waitFor(() => expect(body).toEqual({ title: 'Buy milk', due: '2026-12-01' }));
  });

  it('shows the account selector with two active accounts and sends the choice', async () => {
    mockTasks([account(), account({ id: 'a2', email: 'b@example.com' }), account({ id: 'a3', email: 'old@example.com', status: 'disabled' })]);
    let body: unknown;
    server.use(http.post('/api/tasks', async ({ request }) => ((body = await jsonBody(request)), HttpResponse.json({ id: 'n', title: 'X', list: 'L' }))));
    renderAt();
    await userEvent.click(await screen.findByRole('button', { name: 'New task' }));
    const dialog = await screen.findByRole('dialog');
    const select = await within(dialog).findByRole('combobox', { name: 'Account' });
    expect(within(select).queryByRole('option', { name: 'old@example.com' })).not.toBeInTheDocument();
    await userEvent.selectOptions(select, 'a2');
    await userEvent.type(within(dialog).getByLabelText('Title'), 'X');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Create' }));
    await waitFor(() => expect(body).toEqual({ title: 'X', accountId: 'a2' }));
  });
});
