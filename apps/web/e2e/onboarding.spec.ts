import { expect, test } from '@playwright/test';

// A Desktop-app OAuth client, as downloaded from Google Cloud Console (fake values).
const OAUTH_CLIENT = JSON.stringify({
  installed: {
    client_id: 'smoke-client.apps.googleusercontent.com',
    client_secret: 'smoke-client-secret',
    project_id: 'smoke',
    auth_uri: 'https://accounts.google.com/o/oauth2/auth',
    token_uri: 'https://oauth2.googleapis.com/token',
    redirect_uris: ['http://localhost'],
  },
});

test('onboarding wizard walks from an empty install to Today', async ({ page }) => {
  await page.goto('/');
  await expect(page).toHaveURL(/\/onboarding\/mail$/);

  // Step 1: upload the OAuth client, then connect (the simulated consent redirects straight back to the callback).
  await page.getByLabel('OAuth client file').setInputFiles({
    name: 'client.json',
    mimeType: 'application/json',
    buffer: Buffer.from(OAUTH_CLIENT),
  });
  const connect = page.getByRole('link', { name: 'Connect with Google' });
  await expect(connect).toBeVisible();
  await connect.click();
  await expect(page.getByText('Account connected.')).toBeVisible();
  await expect(page.getByRole('list', { name: 'Connected accounts' })).toContainText('jarvis.e2e@example.com');
  await page.getByRole('link', { name: 'Continue' }).click();

  // Step 2: a subscription token (fake), verified by the simulated agent.
  await expect(page).toHaveURL(/\/onboarding\/agent$/);
  await page.getByLabel('Claude token').fill('sk-ant-oat01-smoke-test-token');
  await page.getByRole('button', { name: 'Verify' }).click();
  await expect(page.getByRole('status')).toContainText('Connected');
  await page.getByRole('link', { name: 'Continue' }).click();

  // Step 3: preferences with the defaults.
  await expect(page).toHaveURL(/\/onboarding\/preferences$/);
  await expect(page.getByRole('heading', { name: 'Preferences' })).toBeVisible();
  await page.getByRole('button', { name: 'Finish setup' }).click();

  // Step 4: done, then the dashboard.
  await expect(page).toHaveURL(/\/onboarding\/done$/);
  await expect(page.getByRole('heading', { name: 'All set' })).toBeVisible();
  await page.getByRole('button', { name: 'Go to dashboard' }).click();
  await expect(page).toHaveURL(/\/$/);
  await expect(page.getByRole('navigation').first()).toBeVisible();
  await expect(page.getByText('Set up Jarvis')).toHaveCount(0);
});
