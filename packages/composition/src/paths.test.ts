import type { JarvisConfig } from '@jarvis/config';
import { describe, expect, it } from 'vitest';
import { authPaths, requireDatabaseUrl } from './paths';

describe('authPaths', () => {
  it('resolves relative dirs against the config directory and keeps absolute ones', () => {
    const config = { secretsDir: 'secrets', dataDir: '/abs/data' } as JarvisConfig;
    expect(authPaths(config, '/etc/jarvis')).toEqual({
      clientSecretPath: '/etc/jarvis/secrets/google_oauth_client',
      tokenDir: '/abs/data/tokens',
    });
  });
});

describe('requireDatabaseUrl', () => {
  it('returns DATABASE_URL', () => {
    expect(requireDatabaseUrl({ DATABASE_URL: 'postgres://h/db' })).toBe('postgres://h/db');
  });

  it('fails clearly when DATABASE_URL is missing or blank', () => {
    expect(() => requireDatabaseUrl({})).toThrow(/DATABASE_URL/);
    expect(() => requireDatabaseUrl({ DATABASE_URL: '  ' })).toThrow(/DATABASE_URL/);
  });
});
