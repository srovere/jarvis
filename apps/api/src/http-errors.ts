import { DomainError } from '@jarvis/core';
import {
  Catch,
  HttpException,
  Logger,
  type ArgumentsHost,
  type ExceptionFilter,
} from '@nestjs/common';

interface ResponseLike {
  status(code: number): { json(body: unknown): unknown };
}

/** Every error body is `{ error: string }`: domain errors are 400, HTTP exceptions keep their status, the rest is 500. */
@Catch()
export class ErrorFilter implements ExceptionFilter {
  private readonly logger = new Logger('ErrorFilter');

  catch(exception: unknown, host: ArgumentsHost): void {
    const res = host.switchToHttp().getResponse<ResponseLike>();
    if (exception instanceof HttpException) {
      res.status(exception.getStatus()).json({ error: messageOf(exception) });
    } else if (exception instanceof DomainError) {
      res.status(400).json({ error: exception.message });
    } else {
      this.logger.error(exception instanceof Error ? exception.message : String(exception));
      res.status(500).json({ error: 'Internal error' });
    }
  }
}

function messageOf(e: HttpException): string {
  const body = e.getResponse();
  if (typeof body === 'string') return body;
  const { error, message } = body as { error?: unknown; message?: unknown };
  if (typeof message === 'string') return message;
  if (Array.isArray(message)) return message.join(', ');
  return typeof error === 'string' ? error : e.message;
}
