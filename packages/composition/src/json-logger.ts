import type { LoggerService } from '@nestjs/common';
import type { LogSink } from './tokens';

type Level = 'fatal' | 'error' | 'warn' | 'info' | 'debug' | 'verbose';

/** A stack trace: a first line followed by indented `at` frames. */
const STACK = /\n\s+at /;

/** Nest logger writing one JSON object per line to a sink (stderr in production; stdout stays clean). */
export class JsonLogger implements LoggerService {
  constructor(private readonly sink: LogSink) {}

  log(message: unknown, ...params: unknown[]): void {
    this.write('info', message, params);
  }

  fatal(message: unknown, ...params: unknown[]): void {
    this.write('fatal', message, params);
  }

  error(message: unknown, ...params: unknown[]): void {
    this.write('error', message, params);
  }

  warn(message: unknown, ...params: unknown[]): void {
    this.write('warn', message, params);
  }

  debug(message: unknown, ...params: unknown[]): void {
    this.write('debug', message, params);
  }

  verbose(message: unknown, ...params: unknown[]): void {
    this.write('verbose', message, params);
  }

  /**
   * Nest passes `(message, context?)`, or `(message, stack?, context?)` for errors; a lone error parameter is the
   * stack when it looks like one, otherwise the context.
   */
  private write(level: Level, message: unknown, params: unknown[]): void {
    const isError = level === 'error' || level === 'fatal';
    const loneStack = isError && params.length === 1 && typeof params[0] === 'string' && STACK.test(params[0]);
    const last = params.at(-1);
    const context = !loneStack && typeof last === 'string' ? last : undefined;
    const stack = loneStack || (isError && params.length > 1) ? params[0] : undefined;
    const msg = message instanceof Error ? message.message : message;
    this.sink(
      JSON.stringify({
        level,
        ...(context !== undefined ? { context } : {}),
        msg,
        ...(typeof stack === 'string' ? { stack } : {}),
      }),
    );
  }
}
