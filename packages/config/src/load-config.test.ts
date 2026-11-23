import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { loadConfig } from './index';

const dir = mkdtempSync(join(tmpdir(), 'jarvis-config-'));
let counter = 0;

function write(yaml: string): string {
  const path = join(dir, `config-${counter++}.yaml`);
  writeFileSync(path, yaml);
  return path;
}

const GOOGLE = `accounts:
  - id: personal
    provider: google
    email: a@example.com
`;

describe('loadConfig', () => {
  it('applies exact defaults when only accounts is given', () => {
    const config = loadConfig(write(GOOGLE), {});
    expect(config).toEqual({
      timezone: 'America/Argentina/Buenos_Aires',
      workSchedule: { startHour: 9, endHour: 19, workDays: [1, 2, 3, 4, 5] },
      focus: { titlePrefix: '[Focus] ', horizonWorkDays: 5, defaultDurationMinutes: 90 },
      sync: { intervalMinutes: 5, gmailInitialWindowDays: 90 },
      briefing: { maxPriorityEmails: 10 },
      email: { maxBodyChars: 4000 },
      accounts: [{ id: 'personal', provider: 'google', email: 'a@example.com' }],
      mcp: { bind: '127.0.0.1', port: 3002, tokenFile: '/run/secrets/mcp_token' },
      secretsDir: '/run/secrets',
      dataDir: '/data',
    });
  });

  it('treats an empty file as {} with no accounts', () => {
    expect(loadConfig(write(''), {}).accounts).toEqual([]);
  });

  it('throws naming the path when the file is missing', () => {
    const missing = join(dir, 'nope.yaml');
    expect(() => loadConfig(missing, {})).toThrow(missing);
  });

  it('rejects startHour >= endHour with the workSchedule path', () => {
    const path = write('workSchedule: { startHour: 19, endHour: 9 }');
    expect(() => loadConfig(path, {})).toThrow(/workSchedule: startHour must be lower/);
  });

  it('rejects invalid workDays', () => {
    expect(() => loadConfig(write('workSchedule: { workDays: [0] }'), {})).toThrow(/workSchedule\.workDays/);
    expect(() => loadConfig(write('workSchedule: { workDays: [] }'), {})).toThrow(/workDays/);
    expect(() => loadConfig(write('workSchedule: { workDays: [1, 1] }'), {})).toThrow(/unique/);
  });

  it('rejects an unknown timezone', () => {
    expect(() => loadConfig(write('timezone: Mars/Olympus'), {})).toThrow(/invalid timezone/);
  });

  it('accepts a valid IANA alias', () => {
    expect(loadConfig(write('timezone: US/Eastern'), {}).timezone).toBe('US/Eastern');
  });

  it('validates accounts', () => {
    const bad = (body: string) => () => loadConfig(write(`accounts:\n${body}`), {});
    expect(bad('  - { id: Bad, provider: google, email: a@example.com }')).toThrow(/accounts\.0\.id/);
    expect(bad('  - { id: ok, provider: google, email: nope }')).toThrow(/accounts\.0\.email/);
    expect(bad('  - { id: ok, provider: outlook, email: a@example.com }')).toThrow(/accounts\.0/);
    expect(
      bad('  - { id: a, provider: google, email: a@example.com }\n  - { id: a, provider: google, email: b@example.com }'),
    ).toThrow(/unique/);
  });

  describe('env overrides', () => {
    it('applies and converts to number, case-insensitively', () => {
      const config = loadConfig(write(GOOGLE), { JARVIS__SYNC__INTERVALMINUTES: '10' });
      expect(config.sync.intervalMinutes).toBe(10);
    });

    it('overrides YAML values and parses booleans/arrays/strings', () => {
      const path = write('sync: { intervalMinutes: 3 }\n');
      const config = loadConfig(path, {
        JARVIS__SYNC__INTERVALMINUTES: '7',
        JARVIS__WORKSCHEDULE__WORKDAYS: '[1,2,3]',
        JARVIS__FOCUS__TITLEPREFIX: 'Foco ',
        JARVIS__MCP__PORT: '4000',
      });
      expect(config.sync.intervalMinutes).toBe(7);
      expect(config.workSchedule.workDays).toEqual([1, 2, 3]);
      expect(config.focus.titlePrefix).toBe('Foco ');
      expect(config.mcp.port).toBe(4000);
    });

    it('validates overridden values', () => {
      expect(() => loadConfig(write(''), { JARVIS__SYNC__INTERVALMINUTES: 'abc' })).toThrow(/sync\.intervalMinutes/);
    });

    it('rejects unknown keys naming the variable', () => {
      expect(() => loadConfig(write(''), { JARVIS__SYNC__NOPE: '1' })).toThrow(/JARVIS__SYNC__NOPE/);
      expect(() => loadConfig(write(''), { JARVIS__NOPE: '1' })).toThrow(/JARVIS__NOPE/);
      expect(() => loadConfig(write(''), { JARVIS__SYNC__INTERVALMINUTES__X: '1' })).toThrow(
        /JARVIS__SYNC__INTERVALMINUTES__X/,
      );
    });

    it('does not allow overriding accounts', () => {
      expect(() => loadConfig(write(''), { JARVIS__ACCOUNTS__ID: 'x' })).toThrow(/JARVIS__ACCOUNTS__ID/);
    });

    it('ignores unrelated variables', () => {
      expect(loadConfig(write(''), { PATH: '/bin', JARVIS_OTHER: 'x' }).sync.intervalMinutes).toBe(5);
    });
  });

  it('parses the repository example file', () => {
    const config = loadConfig(resolve(__dirname, '../../../jarvis.config.example.yaml'), {});
    expect(config.accounts).toEqual([]);
    expect(config.timezone).toBe('America/Argentina/Buenos_Aires');
  });
});
