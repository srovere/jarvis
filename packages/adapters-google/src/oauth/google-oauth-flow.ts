import { randomBytes } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { ReauthRequired } from '@jarvis/core';
import { OAuth2Client, type Credentials } from 'google-auth-library';
import { GOOGLE_SCOPES } from './scopes';
import type { FileTokenStore } from './token-store';

export interface GoogleOAuthFlowOptions {
  /** Puerto del callback loopback (`JARVIS_OAUTH_PORT`, por defecto 53682). */
  readonly port: number;
  /** Host donde escucha el servidor (`JARVIS_OAUTH_BIND`, por defecto 127.0.0.1). */
  readonly bindHost: string;
  /** Tiempo máximo de espera del callback. */
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
      port: Number(process.env.JARVIS_OAUTH_PORT ?? 53682),
      bindHost: process.env.JARVIS_OAUTH_BIND ?? '127.0.0.1',
      timeoutMs: 5 * 60 * 1000,
      ...options,
    };
  }

  /** Autoriza una cuenta vía loopback: imprime la URL en stderr, espera el callback y guarda el token. */
  async authorizeInteractive(accountId: string): Promise<void> {
    const secret = await this.readClientSecret();
    const state = randomBytes(16).toString('hex');
    const { server, codePromise } = this.listenForCallback(state);
    try {
      const port = await this.listening(server);
      const client = new OAuth2Client(secret.client_id, secret.client_secret, `http://127.0.0.1:${port}${CALLBACK_PATH}`);
      const url = client.generateAuthUrl({
        access_type: 'offline',
        prompt: 'consent',
        scope: [...GOOGLE_SCOPES],
        state,
      });
      process.stderr.write(`Abrí esta URL en tu navegador para autorizar la cuenta ${accountId}:\n${url}\n`);
      const code = await codePromise;
      const { tokens } = await client.getToken(code);
      if (!tokens.refresh_token) {
        throw new Error('Google no devolvió refresh_token; revocá el acceso de la app en tu cuenta y reintentá');
      }
      await this.store.write(accountId, tokens);
    } finally {
      server.close();
      server.closeAllConnections();
    }
  }

  /** Cliente OAuth2 con las credenciales guardadas; persiste los tokens refrescados. */
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
        process.stderr.write(`No se pudo guardar el token de ${accountId}: ${String(error)}\n`);
      });
    });
    return client;
  }

  private async readClientSecret(): Promise<ClientSecret> {
    const json = JSON.parse(await readFile(this.clientSecretPath, 'utf8')) as {
      installed?: ClientSecret;
      web?: ClientSecret;
    } & Partial<ClientSecret>;
    const secret = json.installed ?? json.web ?? (json as ClientSecret);
    if (!secret.client_id || !secret.client_secret) {
      throw new Error(`Client secret inválido en ${this.clientSecretPath}`);
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

  private listenForCallback(state: string): { server: Server; codePromise: Promise<string> } {
    let settle!: { resolve(code: string): void; reject(error: Error): void };
    const codePromise = new Promise<string>((resolve, reject) => {
      settle = { resolve, reject };
    });
    const timer = setTimeout(
      () => settle.reject(new Error('Tiempo de espera agotado (5 minutos) esperando la autorización de Google')),
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
        res.writeHead(400, { 'content-type': 'text/plain; charset=utf-8' }).end('State inválido');
        return; // no consume el intento: puede llegar el callback legítimo
      }
      clearTimeout(timer);
      if (error || !code) {
        res.writeHead(400, { 'content-type': 'text/plain; charset=utf-8' }).end('Autorización rechazada');
        settle.reject(new Error(`Google rechazó la autorización: ${error ?? 'sin code'}`));
        return;
      }
      res
        .writeHead(200, { 'content-type': 'text/html; charset=utf-8' })
        .end('<!doctype html><meta charset="utf-8"><p>Listo, podés cerrar esta pestaña.</p>');
      settle.resolve(code);
    });
    // Evita un timer colgado si el servidor falla al iniciar.
    codePromise.then(
      () => clearTimeout(timer),
      () => clearTimeout(timer),
    );
    return { server, codePromise };
  }
}
