import { spawn } from 'node:child_process';
import type { AgentRunner, AgentVerification } from '@jarvis/core';

/** Minimal view of a spawned child process, so tests can inject a fake. */
export interface CliProcess {
  stdout: NodeJS.ReadableStream | null;
  stderr: NodeJS.ReadableStream | null;
  on(event: 'close', listener: (code: number | null) => void): unknown;
  on(event: 'error', listener: (error: Error) => void): unknown;
  kill(): boolean;
}

export type CliSpawner = (command: string, args: string[], env: NodeJS.ProcessEnv) => CliProcess;

export const nodeSpawner: CliSpawner = (command, args, env) =>
  spawn(command, args, { env, stdio: ['ignore', 'pipe', 'pipe'] });

export interface AgentTokenSource {
  read(): Promise<string | null>;
}

export interface ClaudeCliRunnerOptions {
  tokens: AgentTokenSource;
  spawner?: CliSpawner;
  /** Executable to run. Default `claude`. */
  cliPath?: string;
  /** Default 60 000. */
  timeoutMs?: number;
}

const VERIFY_PROMPT = 'Reply with OK';
const FORWARDED_ENV = ['PATH', 'HOME', 'TMPDIR'] as const;

/** Verifies a Claude subscription token by running the `claude` CLI headless (`claude -p ... --output-format json`). */
export class ClaudeCliRunner implements AgentRunner {
  readonly kind = 'claude';
  private readonly spawner: CliSpawner;
  private readonly cliPath: string;
  private readonly timeoutMs: number;

  constructor(private readonly options: ClaudeCliRunnerOptions) {
    this.spawner = options.spawner ?? nodeSpawner;
    this.cliPath = options.cliPath ?? 'claude';
    this.timeoutMs = options.timeoutMs ?? 60_000;
  }

  async verify(): Promise<AgentVerification> {
    const token = await this.options.tokens.read();
    if (!token) return { ok: false, reason: 'No Claude token saved: run `claude setup-token` and paste it.' };
    const started = Date.now();
    const run = await this.run(token);
    if ('failure' in run) return { ok: false, reason: run.failure };
    return this.interpret(run, token, Date.now() - started);
  }

  /** Only an allow-listed environment reaches the child: never `ANTHROPIC_API_KEY` or other credentials. */
  private childEnv(token: string): NodeJS.ProcessEnv {
    const env: NodeJS.ProcessEnv = {};
    for (const key of FORWARDED_ENV) if (process.env[key] !== undefined) env[key] = process.env[key];
    env.CLAUDE_CODE_OAUTH_TOKEN = token;
    return env;
  }

  private run(token: string): Promise<{ stdout: string; code: number | null } | { failure: string }> {
    return new Promise((resolve) => {
      let settled = false;
      let stdout = '';
      let child: CliProcess | undefined;
      let timer: NodeJS.Timeout | undefined;
      const done = (value: { stdout: string; code: number | null } | { failure: string }) => {
        if (settled) return;
        settled = true;
        if (timer) clearTimeout(timer);
        resolve(value);
      };
      try {
        child = this.spawner(this.cliPath, ['-p', VERIFY_PROMPT, '--output-format', 'json'], this.childEnv(token));
      } catch {
        return done({ failure: 'Could not start the `claude` CLI' });
      }
      timer = setTimeout(() => {
        done({ failure: 'Timed out waiting for the Claude CLI' });
        child?.kill();
      }, this.timeoutMs);
      child.stdout?.on('data', (chunk: Buffer | string) => {
        stdout += chunk.toString();
      });
      // stderr is drained so the child never blocks on a full pipe; it is never read or logged.
      child.stderr?.on('data', () => undefined);
      child.on('error', (error) =>
        done({
          failure:
            (error as NodeJS.ErrnoException).code === 'ENOENT'
              ? 'The `claude` CLI was not found'
              : 'Could not start the `claude` CLI',
        }),
      );
      child.on('close', (code) => done({ stdout, code }));
    });
  }

  private interpret(run: { stdout: string; code: number | null }, token: string, latencyMs: number): AgentVerification {
    let out: { is_error?: unknown; result?: unknown; api_error_status?: unknown };
    try {
      out = JSON.parse(run.stdout);
    } catch {
      return { ok: false, reason: `The claude CLI returned unreadable output (exit ${run.code ?? 'none'})` };
    }
    if (typeof out !== 'object' || out === null) {
      return { ok: false, reason: 'The claude CLI returned unreadable output' };
    }
    if (run.code === 0 && out.is_error === false) return { ok: true, latencyMs };
    if (out.api_error_status === 401) return { ok: false, reason: 'Token rejected: run `claude setup-token` again' };
    const reason = typeof out.result === 'string' && out.result.trim() ? out.result.trim() : `claude exited with code ${run.code}`;
    // Redact first, then cap: a token cut by the limit would otherwise survive partially.
    return { ok: false, reason: capReason(reason.split(token).join('[redacted]')) };
  }
}

const MAX_REASON_CHARS = 500;

function capReason(text: string): string {
  return text.length <= MAX_REASON_CHARS ? text : `${text.slice(0, MAX_REASON_CHARS - 1)}…`;
}
