import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { describe, expect, it } from 'vitest';
import { App } from '@/app/app';
import { createTestRouter } from '@/app/router';
import { account, fresh, mockOnboarding } from '@/test/fixtures';
import { server } from '@/test/server';

const renderAt = (path: string) => render(<App router={createTestRouter([path])} />);
const file = (content: string) => new File([content], 'client.json', { type: 'application/json' });

describe('mail step', () => {
  it('shows the Google Cloud guide with four items while no client is stored', async () => {
    mockOnboarding({ setup: fresh });
    renderAt('/onboarding/mail');
    expect(await screen.findByText('Create a Google Cloud project')).toBeInTheDocument();
    expect(screen.getAllByRole('group')).toHaveLength(4);
    expect(screen.getByRole('link', { name: /OAuth consent screen/ })).toHaveAttribute('href', expect.stringContaining('console.cloud.google.com'));
    expect(screen.getByRole('button', { name: 'Connect with Google' })).toBeDisabled();
  });

  it('uploads the client file as {json} and shows the API error for a rejected one', async () => {
    mockOnboarding({ setup: fresh });
    const bodies: unknown[] = [];
    server.use(
      http.put('/api/google/client', async ({ request }) => {
        bodies.push(await request.json());
        return HttpResponse.json({ error: 'The client is of type "web"; create a Desktop app client.' }, { status: 400 });
      }),
    );
    renderAt('/onboarding/mail');
    await userEvent.upload(await screen.findByLabelText('OAuth client file'), file('{"web":{}}'));
    expect(await screen.findByRole('alert')).toHaveTextContent('The client is of type "web"; create a Desktop app client.');
    expect(bodies).toEqual([{ json: '{"web":{}}' }]);
  });

  it('enables Connect with Google after a successful upload', async () => {
    mockOnboarding({ setup: fresh });
    let stored = false;
    server.use(
      http.get('/api/setup/status', () => HttpResponse.json({ ...fresh, googleClient: stored ? 'present' : 'missing' })),
      http.put('/api/google/client', () => {
        stored = true;
        return new HttpResponse(null, { status: 204 });
      }),
    );
    renderAt('/onboarding/mail');
    await userEvent.upload(await screen.findByLabelText('OAuth client file'), file('{"installed":{}}'));
    const connect = await screen.findByRole('link', { name: 'Connect with Google' });
    expect(connect).toHaveAttribute('href', '/api/oauth/google/start?returnTo=/onboarding');
  });

  it('lists connected accounts and offers to add another', async () => {
    mockOnboarding({ setup: { ...fresh, accounts: 1, googleClient: 'present' }, accounts: [account()] });
    renderAt('/onboarding/mail?connected=a1');
    expect(await screen.findByText('me@example.com')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Add another account' })).toHaveAttribute('href', '/api/oauth/google/start?returnTo=/onboarding');
    expect(screen.getByRole('link', { name: 'Continue' })).toHaveAttribute('href', '/onboarding/agent');
    await waitFor(() => expect(screen.queryByRole('alert')).not.toBeInTheDocument());
  });

  it('shows the error from the OAuth callback', async () => {
    mockOnboarding({ setup: { ...fresh, googleClient: 'present' } });
    renderAt('/onboarding/mail?error=The%20authorization%20request%20is%20invalid%20or%20expired.%20Start%20again.');
    expect(await screen.findByRole('alert')).toHaveTextContent('The authorization request is invalid or expired. Start again.');
  });
});
