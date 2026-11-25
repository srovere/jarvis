import { spawnSync, type SpawnSyncReturns } from 'node:child_process';
import { chmodSync, copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

const SCRIPT = join(__dirname, '..', 'jarvis');

/** A `docker` stand-in: records every call and answers the few commands `./jarvis` makes. */
const FAKE_DOCKER = `#!/bin/sh
echo "$*" >> "$FAKE_DOCKER_LOG"
case "$1 $2" in
  "compose version") [ "\${FAKE_COMPOSE_MISSING:-}" = 1 ] && exit 1; echo "Docker Compose version v2.39.4"; exit 0 ;;
  "volume ls") printf '%s\\n' \${FAKE_DOCKER_VOLUMES:-}; exit 0 ;;
  "compose ps") echo "fake-api-container"; exit 0 ;;
  "compose up") exit \${FAKE_UP_EXIT:-0} ;;
esac
case "$1" in
  inspect) echo "\${FAKE_DOCKER_HEALTH:-healthy}"; exit 0 ;;
esac
exit 0
`;

describe('./jarvis script', () => {
  let dir: string;
  let bin: string;
  let log: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'jarvis-script-'));
    bin = join(dir, 'bin');
    log = join(dir, 'docker.log');
    mkdirSync(bin);
    writeFileSync(join(bin, 'docker'), FAKE_DOCKER);
    chmodSync(join(bin, 'docker'), 0o755);
    copyFileSync(SCRIPT, join(dir, 'jarvis'));
    chmodSync(join(dir, 'jarvis'), 0o755);
  });

  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  function run(args: string[], env: Record<string, string> = {}): SpawnSyncReturns<string> {
    return spawnSync(join(dir, 'jarvis'), args, {
      cwd: dir,
      encoding: 'utf8',
      env: { PATH: `${bin}:${process.env.PATH}`, HOME: dir, FAKE_DOCKER_LOG: log, JARVIS_START_TIMEOUT: '5', ...env },
    });
  }

  const calls = () => (existsSync(log) ? readFileSync(log, 'utf8').trim().split('\n') : []);
  const secret = (name: string) => join(dir, 'secrets', name);

  it('creates the secrets once with mode 0600 and the right lengths', () => {
    const r = run(['start']);
    expect(r.status, r.stderr).toBe(0);
    const token = readFileSync(secret('mcp_token'), 'utf8').trim();
    const password = readFileSync(secret('pg_password'), 'utf8').trim();
    expect(token).toMatch(/^[0-9a-f]{64}$/);
    expect(password).toMatch(/^[0-9a-f]{48}$/);
    expect(statSync(secret('mcp_token')).mode & 0o777).toBe(0o600);
    expect(statSync(secret('pg_password')).mode & 0o777).toBe(0o600);
  });

  it('leaves existing secrets byte-identical on a second run', () => {
    run(['start']);
    const before = [readFileSync(secret('mcp_token')), readFileSync(secret('pg_password'))];
    const r = run(['start']);
    expect(r.status, r.stderr).toBe(0);
    expect(readFileSync(secret('mcp_token')).equals(before[0]!)).toBe(true);
    expect(readFileSync(secret('pg_password')).equals(before[1]!)).toBe(true);
  });

  it('never overwrites a secret the user already has', () => {
    mkdirSync(join(dir, 'secrets'));
    writeFileSync(secret('mcp_token'), 'my-own-token\n');
    run(['start']);
    expect(readFileSync(secret('mcp_token'), 'utf8')).toBe('my-own-token\n');
    expect(existsSync(secret('pg_password'))).toBe(true);
  });

  it('brings the stack up, waits for the api and prints the URL', () => {
    const r = run(['start']);
    expect(r.status, r.stderr).toBe(0);
    expect(calls()).toContain('compose up -d --build');
    expect(r.stdout).toContain('Open http://127.0.0.1:3000');
  });

  it('fails clearly when Docker Compose is not available', () => {
    const r = run(['start'], { FAKE_COMPOSE_MISSING: '1' });
    expect(r.status).not.toBe(0);
    expect(r.stderr).toMatch(/Docker Compose/);
    expect(calls()).not.toContain('compose up -d --build');
  });

  it('warns about a leftover jarvis_tokens volume', () => {
    const r = run(['start'], { FAKE_DOCKER_VOLUMES: 'pgdata jarvis_jarvis_tokens' });
    expect(r.status, r.stderr).toBe(0);
    expect(r.stderr).toMatch(/jarvis_tokens/);
  });

  it('does not warn about the volume when it is absent', () => {
    const r = run(['start'], { FAKE_DOCKER_VOLUMES: 'jarvis_pgdata jarvis_jarvis_data' });
    expect(r.stderr).not.toMatch(/jarvis_tokens/);
  });

  it('points to the api logs when the api never becomes healthy', () => {
    const r = run(['start'], { FAKE_DOCKER_HEALTH: 'starting', JARVIS_START_TIMEOUT: '2' });
    expect(r.status).toBe(1);
    expect(r.stderr).toContain('./jarvis logs api');
    expect(r.stdout).not.toContain('Open http://127.0.0.1:3000');
  });

  it('stops, reports status and passes log arguments through', () => {
    expect(run(['stop']).status).toBe(0);
    expect(run(['status']).status).toBe(0);
    expect(run(['logs', '-f', 'api']).status).toBe(0);
    expect(calls()).toEqual(expect.arrayContaining(['compose down', 'compose ps', 'compose logs -f api']));
  });

  it('prints usage and exits 2 for an unknown subcommand', () => {
    const r = run(['frobnicate']);
    expect(r.status).toBe(2);
    expect(r.stderr).toMatch(/usage/i);
    expect(existsSync(join(dir, 'secrets'))).toBe(false);
  });

  it('prints usage and exits 2 without a subcommand', () => {
    expect(run([]).status).toBe(2);
  });
});
