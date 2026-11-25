import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { describe, expect, it } from 'vitest';
import { App } from '@/app/app';
import { createTestRouter } from '@/app/router';
import { account, jsonBody, mockShell } from '@/test/fixtures';
import { server } from '@/test/server';

const msg = { id: 'm1', accountId: 'a1', threadId: 't1', from: '<external_content source="email">Ana &lt;ana@x.com&gt;</external_content>', subject: '<external_content source="email">Budget</external_content>', date: '2026-11-20T10:00:00.000+00:00', body: '<external_content source="email"><img src=x onerror=alert(1)> Please review</external_content>' };

const renderAt = (p: string) => render(<App router={createTestRouter([p])} />);

describe('Mail search', () => {
  it('sends the filters and lists threads linking to the thread view', async () => {
    mockShell([account(), account({ id: 'a2', email: 'b@example.com' })]);
    let query = '';
    server.use(
      http.get('/api/mail/search', ({ request }) => {
        query = new URL(request.url).search;
        return HttpResponse.json({ emails: [msg] });
      }),
    );
    renderAt('/mail');
    await userEvent.type(await screen.findByLabelText('Text'), 'budget');
    await userEvent.type(screen.getByLabelText('Sender'), 'ana');
    await userEvent.selectOptions(await screen.findByRole('combobox', { name: 'Account' }), 'a2');
    await userEvent.click(screen.getByRole('button', { name: 'Search' }));
    const link = await screen.findByRole('link', { name: /Budget/ });
    expect(link).toHaveAttribute('href', '/mail/a1/t1');
    const params = new URLSearchParams(query);
    expect(Object.fromEntries(params)).toEqual({ q: 'budget', from: 'ana', accountId: 'a2' });
  });
});

describe('Thread and draft dialog', () => {
  function mockThread() {
    mockShell();
    server.use(http.get('/api/mail/threads/a1/t1', () => HttpResponse.json({ threadId: 't1', subject: msg.subject, messages: [msg] })));
  }

  it('renders message text as plain text, never HTML', async () => {
    mockThread();
    renderAt('/mail/a1/t1');
    expect(await screen.findByText(/<img src=x onerror=alert\(1\)> Please review/)).toBeInTheDocument();
    expect(document.querySelector('img')).toBeNull();
  });

  it('never offers Send, posts the draft body and links to Gmail', async () => {
    mockThread();
    let body: unknown;
    server.use(
      http.post('/api/mail/drafts', async ({ request }) => {
        body = await jsonBody(request);
        return HttpResponse.json({ draftId: 'd1', threadId: 't1', to: ['ana@x.com'], subject: 'Re: Budget', gmailUrl: 'https://mail.google.com/mail/#drafts/d1' });
      }),
    );
    renderAt('/mail/a1/t1');
    await userEvent.click(await screen.findByRole('button', { name: 'Reply' }));
    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByText(/not sent/i)).toBeInTheDocument();
    await userEvent.type(within(dialog).getByLabelText('Message'), 'Looks good');
    expect(screen.queryAllByText(/send/i)).toEqual([]);
    expect(screen.queryAllByRole('button', { name: /send/i })).toEqual([]);
    await userEvent.click(within(dialog).getByRole('button', { name: 'Save draft' }));
    const open = await within(dialog).findByRole('link', { name: 'Open in Gmail' });
    expect(open).toHaveAttribute('href', 'https://mail.google.com/mail/#drafts/d1');
    expect(body).toEqual({ threadId: 't1', body: 'Looks good' });
    expect(screen.queryAllByText(/send/i)).toEqual([]);
  });
});
