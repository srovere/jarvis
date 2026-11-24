import { randomBytes } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { ReauthRequired } from '@jarvis/core';
import { OAuth2Client, type Credentials } from 'google-auth-library';
import { GOOGLE_SCOPES } from './scopes';
import type { FileTokenStore } from './token-store';

export interface GoogleOAuthFlowOptions {
  /** Loopback callback port (`JARVIS_OAUTH_PORT`, default 53682). */
  readonly port: number;
  /** Host the server listens on (`JARVIS_OAUTH_BIND`, default 127.0.0.1). */
  readonly bindHost: string;
  /** Maximum wait for the callback. */
  readonly timeoutMs: number;
}

const CALLBACK_PATH = '/oauth2callback';

interface ClientSecret {
  readonly client_id: string;
  readonly client_secret: string;
}

export class GoogleOAuthFlow {
  private readonly options: GoogleOAuthFlowOptions;

  constructor(
    private readonly clientSecretPath: string,
    private readonly store: FileTokenStore,
    options: Partial<GoogleOAuthFlowOptions> = {},
  ) {
    this.options = {
      port: GoogleOAuthFlow.envPort(),
      bindHost: process.env.JARVIS_OAUTH_BIND ?? '127.0.0.1',
      timeoutMs: 5 * 60 * 1000,
      ...options,
    };
  }

  private static envPort(): number {
    const raw = process.env.JARVIS_OAUTH_PORT;
    if (raw === undefined) return 53682;
    const port = Number(raw);
    if (raw.trim() === '' || !Number.isInteger(port) || port < 1 || port > 65535) {
      throw new Error(`Invalid JARVIS_OAUTH_PORT: ${JSON.stringify(raw)} (must be an integer between 1 and 65535)`);
    }
    return port;
  }

  /** Authorizes an account via loopback: prints the URL to stderr, waits for the callback and stores the token. */
  async authorizeInteractive(accountId: string): Promise<void> {
    const secret = await this.readClientSecret();
    const state = randomBytes(16).toString('hex');
    const { server, codePromise, cancelTimer } = this.listenForCallback(state);
    try {
      const port = await this.listening(server);
      const client = new OAuth2Client(secret.client_id, secret.client_secret, `http://127.0.0.1:${port}${CALLBACK_PATH}`);
      const url = client.generateAuthUrl({
        access_type: 'offline',
        prompt: 'consent',
        scope: [...GOOGLE_SCOPES],
        state,
      });
      process.stderr.write(`Open this URL in your browser to authorize account ${accountId}:\n${url}\n`);
      const code = await codePromise;
      const { tokens } = await client.getToken(code);
      if (!tokens.refresh_token) {
        throw new Error("Google returned no refresh_token; revoke the app's access in your Google account and retry");
      }
      await this.store.write(accountId, tokens);
    } finally {
      cancelTimer();
      server.close();
      server.closeAllConnections();
    }
  }

  /** OAuth2 client with the stored credentials; persists refreshed tokens. */
  async client(accountId: string): Promise<OAuth2Client> {
    const stored = await this.store.read(accountId);
    if (!stored) throw new ReauthRequired(accountId);
    const secret = await this.readClientSecret();
    const client = new OAuth2Client(secret.client_id, secret.client_secret);
    client.setCredentials(stored);
    client.on('tokens', (fresh: Credentials) => {
      const merged = { ...stored, ...fresh, refresh_token: fresh.refresh_token ?? stored.refresh_token };
      Object.assign(stored, merged);
      this.store.write(accountId, merged).catch((error: unknown) => {
        process.stderr.write(`Could not save the token for ${accountId}: ${String(error)}\n`);
      });
    });
    return client;
  }

  /** Changes when the stored token file is rewritten (re-authorization or refresh); `none` without a token. */
  async tokenFingerprint(accountId: string): Promise<string> {
    const stat = await this.store.stat(accountId);
    return stat ? `${stat.mtimeMs}:${stat.size}` : 'none';
  }

  private async readClientSecret(): Promise<ClientSecret> {
    const json = JSON.parse(await readFile(this.clientSecretPath, 'utf8')) as {
      installed?: ClientSecret;
      web?: ClientSecret;
    } & Partial<ClientSecret>;
    const secret = json.installed ?? json.web ?? (json as ClientSecret);
    if (!secret.client_id || !secret.client_secret) {
      throw new Error(`Invalid client secret in ${this.clientSecretPath}`);
    }
    return secret;
  }

  private listening(server: Server): Promise<number> {
    return new Promise((resolve, reject) => {
      server.once('error', reject);
      server.listen(this.options.port, this.options.bindHost, () => {
        resolve((server.address() as AddressInfo).port);
      });
    });
  }

  private listenForCallback(state: string): { server: Server; codePromise: Promise<string>; cancelTimer: () => void } {
    let settle!: { resolve(code: string): void; reject(error: Error): void };
    const codePromise = new Promise<string>((resolve, reject) => {
      settle = { resolve, reject };
    });
    const timer = setTimeout(
      () => settle.reject(new Error('Timed out (5 minutes) waiting for Google authorization')),
      this.options.timeoutMs,
    );
    const server = createServer((req, res) => {
      const url = new URL(req.url ?? '/', 'http://127.0.0.1');
      if (url.pathname !== CALLBACK_PATH) {
        res.writeHead(404).end();
        return;
      }
      const code = url.searchParams.get('code');
      const error = url.searchParams.get('error');
      if (url.searchParams.get('state') !== state) {
        res.writeHead(400, { 'content-type': 'text/plain; charset=utf-8' }).end('Invalid state');
        return; // does not consume the attempt: the legitimate callback may still arrive
      }
      clearTimeout(timer);
      if (error || !code) {
        res.writeHead(400, { 'content-type': 'text/plain; charset=utf-8' }).end('Authorization denied');
        settle.reject(new Error(`Google denied the authorization: ${error ?? 'no code'}`));
        return;
      }
      res
        .writeHead(200, { 'content-type': 'text/html; charset=utf-8' })
        .end('<!doctype html><meta charset="utf-8"><p>Done, you can close this tab.</p>');
      settle.resolve(code);
    });
    // The timer must also be cleared if the server fails to start (e.g. EADDRINUSE).
    return { server, codePromise, cancelTimer: () => clearTimeout(timer) };
  }
}
