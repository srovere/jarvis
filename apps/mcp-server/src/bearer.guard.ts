import { timingSafeEqual } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { Inject, Injectable, UnauthorizedException, type CanActivate, type ExecutionContext } from '@nestjs/common';

/** The bearer token MCP clients must present (read once at startup). */
export const MCP_BEARER_TOKEN = Symbol('McpBearerToken');

/** Reads the token file, trimmed; fails fast when it is missing or empty so the server never runs unauthenticated. */
export function readBearerToken(path: string): string {
  let token: string;
  try {
    token = readFileSync(path, 'utf8').trim();
  } catch (e) {
    const reason = e instanceof Error ? e.message : String(e);
    throw new Error(`No se pudo leer el token MCP en ${path} (mcp.tokenFile): ${reason}`);
  }
  if (!token) throw new Error(`El archivo del token MCP ${path} (mcp.tokenFile) está vacío`);
  return token;
}

/** Requires `Authorization: Bearer <token>`, compared in constant time; otherwise 401 `{ error: 'unauthorized' }`. */
@Injectable()
export class BearerGuard implements CanActivate {
  private readonly expected: Buffer;

  constructor(@Inject(MCP_BEARER_TOKEN) token: string) {
    this.expected = Buffer.from(token, 'utf8');
  }

  canActivate(context: ExecutionContext): boolean {
    const header = context.switchToHttp().getRequest<{ headers: Record<string, unknown> }>().headers.authorization;
    const match = typeof header === 'string' ? /^Bearer\s+(.+)$/i.exec(header.trim()) : null;
    if (!match || !this.matches(match[1]!)) throw new UnauthorizedException({ error: 'unauthorized' });
    return true;
  }

  private matches(presented: string): boolean {
    const given = Buffer.from(presented, 'utf8');
    return given.length === this.expected.length && timingSafeEqual(given, this.expected);
  }
}
