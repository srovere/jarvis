import type { LogSink } from '@jarvis/composition';
import type { LoggerService } from '@nestjs/common';

type Level = 'fatal' | 'error' | 'warn' | 'info' | 'debug' | 'verbose';

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

  /** Nest passes `(message, context?)`, or `(message, stack?, context?)` for errors. */
  private write(level: Level, message: unknown, params: unknown[]): void {
    const context = params.length > 0 && typeof params.at(-1) === 'string' ? (params.at(-1) as string) : undefined;
    const stack = (level === 'error' || level === 'fatal') && params.length > 1 ? params[0] : undefined;
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
