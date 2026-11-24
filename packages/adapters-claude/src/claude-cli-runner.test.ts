import { EventEmitter } from 'node:events';
import { chmod, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PassThrough } from 'node:stream';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { describeAgentRunnerContract } from '@jarvis/contracts';
import { ClaudeCliRunner, nodeSpawner, type CliProcess, type CliSpawner } from './claude-cli-runner';

const TOKEN = 'sk-ant-oat01-TOPSECRET';

class FakeProcess extends EventEmitter implements CliProcess {
  stdout = new PassThrough();
  stderr = new PassThrough();
  killed = false;
  kill() {
    this.killed = true;
    this.emit('close', null);
    return true;
  }
  finish(stdout: string, code: number) {
    this.stdout.end(stdout);
    this.emit('close', code);
  }
}

interface Call {
  command: string;
  args: string[];
  env: NodeJS.ProcessEnv;
}

function harness(token: string | null = TOKEN, timeoutMs?: number, cliPath?: string) {
  const proc = new FakeProcess();
  const calls: Call[] = [];
  const spawner: CliSpawner = (command, args, env) => {
    calls.push({ command, args, env });
    return proc;
  };
  const runner = new ClaudeCliRunner({ tokens: { read: async () => token }, spawner, timeoutMs, cliPath });
  return { proc, calls, runner };
}

const tick = () => new Promise((r) => setImmediate(r));

describe('ClaudeCliRunner', () => {
  const saved = { ...process.env };
  beforeEach(() => {
    process.env.ANTHROPIC_API_KEY = 'sk-ant-api03-must-not-leak';
    process.env.AWS_SECRET_ACCESS_KEY = 'nope';
  });
  afterEach(() => {
    process.env = { ...saved };
  });

  it('spawns claude -p "Reply with OK" --output-format json with only the allow-listed env', async () => {
    const { proc, calls, runner } = harness();
    const p = runner.verify();
    await tick();
    proc.finish(JSON.stringify({ is_error: false, result: 'OK' }), 0);
    const r = await p;
    expect(r.ok).toBe(true);
    expect(calls[0].command).toBe('claude');
    expect(calls[0].args).toEqual(['-p', 'Reply with OK', '--output-format', 'json']);
    expect(calls[0].env.CLAUDE_CODE_OAUTH_TOKEN).toBe(TOKEN);
    expect(Object.keys(calls[0].env).every((k) => ['PATH', 'HOME', 'TMPDIR', 'CLAUDE_CODE_OAUTH_TOKEN'].includes(k))).toBe(true);
    expect(calls[0].env.ANTHROPIC_API_KEY).toBeUndefined();
  });

  it('fails without spawning when no token is saved', async () => {
    const { calls, runner } = harness(null);
    expect(await runner.verify()).toEqual({ ok: false, reason: 'No Claude token saved: run `claude setup-token` and paste it.' });
    expect(calls).toHaveLength(0);
  });

  it('maps a 401 to the setup-token hint', async () => {
    const { proc, runner } = harness();
    const p = runner.verify();
    await tick();
    proc.finish(JSON.stringify({ is_error: true, api_error_status: 401, result: `Failed to authenticate ${TOKEN}` }), 1);
    expect(await p).toEqual({ ok: false, reason: 'Token rejected: run `claude setup-token` again' });
  });

  it('uses result as the reason for other errors, redacting the token', async () => {
    const { proc, runner } = harness();
    const p = runner.verify();
    await tick();
    proc.finish(JSON.stringify({ is_error: true, result: `Rate limited ${TOKEN}` }), 1);
    const r = await p;
    expect(r).toEqual({ ok: false, reason: 'Rate limited [redacted]' });
  });

  it('fails on unparsable output without echoing it', async () => {
    const { proc, runner } = harness();
    const p = runner.verify();
    await tick();
    proc.finish(`garbage ${TOKEN}`, 0);
    const r = await p;
    expect(r.ok).toBe(false);
    expect(JSON.stringify(r)).not.toContain(TOKEN);
  });

  it('requires both exit 0 and is_error false', async () => {
    const { proc, runner } = harness();
    const p = runner.verify();
    await tick();
    proc.finish(JSON.stringify({ is_error: false, result: 'OK' }), 2);
    expect((await p).ok).toBe(false);
  });

  it('kills the child and fails on timeout', async () => {
    const { proc, runner } = harness(TOKEN, 20);
    const r = await runner.verify();
    expect(proc.killed).toBe(true);
    expect(r).toEqual({ ok: false, reason: 'Timed out waiting for the Claude CLI' });
  });

  it('reports a missing CLI', async () => {
    const proc = new FakeProcess();
    const runner = new ClaudeCliRunner({ tokens: { read: async () => TOKEN }, spawner: () => proc });
    const p = runner.verify();
    await tick();
    proc.emit('error', Object.assign(new Error('spawn claude ENOENT'), { code: 'ENOENT' }));
    expect(await p).toEqual({ ok: false, reason: 'The `claude` CLI was not found' });
  });

  it('ignores a spawner that throws synchronously', async () => {
    const runner = new ClaudeCliRunner({
      tokens: { read: async () => TOKEN },
      spawner: () => {
        throw new Error(`boom ${TOKEN}`);
      },
    });
    const r = await runner.verify();
    expect(r.ok).toBe(false);
    expect(JSON.stringify(r)).not.toContain(TOKEN);
  });
});

describe('ClaudeCliRunner against a fake claude executable', () => {
  let dir: string;
  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'fake-claude-'));
    const script = `#!/bin/sh
if [ "$CLAUDE_CODE_OAUTH_TOKEN" = "good" ] && [ -z "$ANTHROPIC_API_KEY" ]; then
  echo '{"is_error":false,"result":"OK"}'
else
  echo '{"is_error":true,"api_error_status":401,"result":"Failed to authenticate. API Error: 401 OAuth access token is invalid."}'
  exit 1
fi
`;
    await writeFile(join(dir, 'claude'), script);
    await chmod(join(dir, 'claude'), 0o755);
  });
  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  describeAgentRunnerContract('ClaudeCliRunner (fake claude on PATH)', async () => {
    process.env.PATH = `${dir}:${process.env.PATH}`;
    process.env.ANTHROPIC_API_KEY = 'sk-ant-api03-must-not-leak';
    const make = (token: string) =>
      new ClaudeCliRunner({ tokens: { read: async () => token }, spawner: nodeSpawner });
    return { working: make('good'), rejected: make('bad-token'), secret: 'bad-token' };
  });
});
