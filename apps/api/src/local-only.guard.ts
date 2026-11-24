import {
  ForbiddenException,
  HttpException,
  Injectable,
  UnsupportedMediaTypeException,
  type CanActivate,
  type ExecutionContext,
  type NestMiddleware,
} from '@nestjs/common';

const PORT = 3000;
const ALLOWED_HOSTS = new Set([`127.0.0.1:${PORT}`, `localhost:${PORT}`]);
const ALLOWED_ORIGINS = new Set([`http://127.0.0.1:${PORT}`, `http://localhost:${PORT}`]);
const READ_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

interface ResponseLike {
  status(code: number): { json(body: unknown): unknown };
}

interface RequestLike {
  method: string;
  headers: Record<string, string | string[] | undefined>;
}

/**
 * Keeps the API local: 403 unless `Host` is `127.0.0.1:3000` / `localhost:3000` (blocks DNS rebinding); for state-changing
 * requests also 403 when an `Origin` is present and foreign (CSRF), and 415 unless the body is `application/json`
 * (a cross-site form cannot send it without a preflight). HEAD and OPTIONS count as GET.
 *
 * Usable as a guard and, applied to every route by the module, as middleware so the static files are covered too.
 */
@Injectable()
export class LocalOnlyGuard implements CanActivate, NestMiddleware {
  canActivate(context: ExecutionContext): boolean {
    this.check(context.switchToHttp().getRequest<RequestLike>());
    return true;
  }

  /** Answers the rejection itself: an error passed to `next` would be rewritten by the static module's handler. */
  use(req: RequestLike, res: ResponseLike, next: () => void): void {
    try {
      this.check(req);
    } catch (e) {
      if (!(e instanceof HttpException)) throw e;
      res.status(e.getStatus()).json(e.getResponse());
      return;
    }
    next();
  }

  check(req: RequestLike): void {
    if (!ALLOWED_HOSTS.has(single(req.headers.host) ?? '')) throw new ForbiddenException({ error: 'forbidden host' });
    if (READ_METHODS.has(req.method.toUpperCase())) return;
    const origin = single(req.headers.origin);
    if (origin !== undefined && !ALLOWED_ORIGINS.has(origin)) throw new ForbiddenException({ error: 'forbidden origin' });
    const type = (single(req.headers['content-type']) ?? '').split(';')[0]!.trim().toLowerCase();
    if (type !== 'application/json') throw new UnsupportedMediaTypeException({ error: 'content-type must be application/json' });
  }
}

function single(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}
