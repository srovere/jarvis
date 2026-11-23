import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { JarvisConfig } from '@jarvis/config';
import { describe, expect, it } from 'vitest';
import { authPaths, mcpTokenPath, requireDatabaseUrl } from './paths';

describe('authPaths', () => {
  it('resolves relative dirs against the config directory and keeps absolute ones', () => {
    const config = { secretsDir: 'secrets', dataDir: '/abs/data' } as JarvisConfig;
    expect(authPaths(config, '/etc/jarvis')).toEqual({
      clientSecretPath: '/etc/jarvis/secrets/google_oauth_client',
      tokenDir: '/abs/data/tokens',
    });
  });
});

describe('mcpTokenPath', () => {
  it('resolves a relative token file against the config directory and keeps an absolute one', () => {
    expect(mcpTokenPath({ mcp: { tokenFile: 'secrets/mcp_token' } } as JarvisConfig, '/etc/jarvis')).toBe(
      '/etc/jarvis/secrets/mcp_token',
    );
    expect(mcpTokenPath({ mcp: { tokenFile: '/run/secrets/mcp_token' } } as JarvisConfig, '/etc/jarvis')).toBe(
      '/run/secrets/mcp_token',
    );
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

describe('requireDatabaseUrl from secret files', () => {
  const dir = mkdtempSync(join(tmpdir(), 'jarvis-paths-'));
  const write = (name: string, content: string): string => {
    const file = join(dir, name);
    writeFileSync(file, content);
    return file;
  };

  it('prefers DATABASE_URL over the file variants', () => {
    const file = write('url', 'postgres://from-file/db');
    expect(requireDatabaseUrl({ DATABASE_URL: 'postgres://h/db', DATABASE_URL_FILE: file })).toBe('postgres://h/db');
  });

  it('reads the whole URL from DATABASE_URL_FILE, trimmed', () => {
    const file = write('url2', 'postgres://u:p@h:5432/db\n');
    expect(requireDatabaseUrl({ DATABASE_URL_FILE: file })).toBe('postgres://u:p@h:5432/db');
  });

  it('builds the URL from PGPASSWORD_FILE with db/jarvis/jarvis defaults', () => {
    const file = write('pw', 'secret\n');
    expect(requireDatabaseUrl({ PGPASSWORD_FILE: file })).toBe('postgres://jarvis:secret@db:5432/jarvis');
  });

  it('honours JARVIS_DB_HOST/USER/NAME and url-encodes the password', () => {
    const file = write('pw2', 'p@ss/w:rd');
    expect(
      requireDatabaseUrl({ PGPASSWORD_FILE: file, JARVIS_DB_HOST: 'pg', JARVIS_DB_USER: 'bob', JARVIS_DB_NAME: 'x' }),
    ).toBe('postgres://bob:p%40ss%2Fw%3Ard@pg:5432/x');
  });

  it('fails clearly when the password file is unreadable or empty', () => {
    expect(() => requireDatabaseUrl({ PGPASSWORD_FILE: join(dir, 'nope') })).toThrow(/PGPASSWORD_FILE/);
    expect(() => requireDatabaseUrl({ PGPASSWORD_FILE: write('empty', '\n') })).toThrow(/PGPASSWORD_FILE/);
  });
});
