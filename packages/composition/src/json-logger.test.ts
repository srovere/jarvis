import { describe, expect, it } from 'vitest';
import { JsonLogger } from './json-logger';

function setup() {
  const lines: string[] = [];
  return { logger: new JsonLogger((l) => lines.push(l)), parsed: () => lines.map((l) => JSON.parse(l)) };
}

describe('JsonLogger', () => {
  it('writes one JSON line per message with level and context', () => {
    const { logger, parsed } = setup();
    logger.log('started', 'NestApplication');
    logger.warn('slow');
    expect(parsed()).toEqual([
      { level: 'info', context: 'NestApplication', msg: 'started' },
      { level: 'warn', msg: 'slow' },
    ]);
  });

  it('includes the stack of errors', () => {
    const { logger, parsed } = setup();
    logger.error('failed', 'Error: x\n    at y', 'ExceptionHandler');
    expect(parsed()).toEqual([{ level: 'error', context: 'ExceptionHandler', msg: 'failed', stack: 'Error: x\n    at y' }]);
  });

  it('keeps a lone stack as the stack, not as the context', () => {
    const { logger, parsed } = setup();
    logger.error('failed', 'Error: x\n    at y (file.ts:1:2)');
    logger.error('failed', 'SomeContext');
    expect(parsed()).toEqual([
      { level: 'error', msg: 'failed', stack: 'Error: x\n    at y (file.ts:1:2)' },
      { level: 'error', context: 'SomeContext', msg: 'failed' },
    ]);
  });
});
