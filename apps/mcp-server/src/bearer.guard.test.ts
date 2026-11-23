import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { UnauthorizedException, type ExecutionContext } from '@nestjs/common';
import { afterAll, describe, expect, it } from 'vitest';
import { BearerGuard, readBearerToken } from './bearer.guard';

function contextWith(authorization?: string): ExecutionContext {
  const request = { headers: authorization === undefined ? {} : { authorization } };
  return { switchToHttp: () => ({ getRequest: () => request }) } as unknown as ExecutionContext;
}

function rejection(guard: BearerGuard, authorization?: string): unknown {
  try {
    guard.canActivate(contextWith(authorization));
  } catch (e) {
    return e;
  }
  throw new Error('expected the guard to reject');
}

describe('BearerGuard', () => {
  const guard = new BearerGuard('s3cret-token');

  it('accepts the configured token', () => {
    expect(guard.canActivate(contextWith('Bearer s3cret-token'))).toBe(true);
    expect(guard.canActivate(contextWith('bearer s3cret-token'))).toBe(true);
  });

  it.each([
    ['a wrong token of the same length', 'Bearer s3cret-tokeX'],
    ['a token of a different length', 'Bearer short'],
    ['a missing header', undefined],
    ['another scheme', 'Basic s3cret-token'],
    ['an empty bearer', 'Bearer '],
  ])('rejects %s with 401 {error: unauthorized}', (_, header) => {
    const e = rejection(guard, header);
    expect(e).toBeInstanceOf(UnauthorizedException);
    expect((e as UnauthorizedException).getStatus()).toBe(401);
    expect((e as UnauthorizedException).getResponse()).toEqual({ error: 'unauthorized' });
  });
});

describe('readBearerToken', () => {
  const dir = mkdtempSync(join(tmpdir(), 'jarvis-token-'));
  afterAll(() => rmSync(dir, { recursive: true, force: true }));

  it('reads the token trimming surrounding whitespace', () => {
    const path = join(dir, 'token');
    writeFileSync(path, '  abc123\n');
    expect(readBearerToken(path)).toBe('abc123');
  });

  it('fails fast when the file is missing', () => {
    expect(() => readBearerToken(join(dir, 'missing'))).toThrow(/No se pudo leer el token MCP/);
  });

  it('fails fast when the file is empty', () => {
    const path = join(dir, 'empty');
    writeFileSync(path, ' \n');
    expect(() => readBearerToken(path)).toThrow(/token MCP .* está vacío/);
  });
});
