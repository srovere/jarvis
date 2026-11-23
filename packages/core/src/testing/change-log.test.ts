import { describe, expect, it } from 'vitest';
import { CursorExpired } from '../domain/errors';
import { ChangeLog } from './change-log';

describe('ChangeLog.sync', () => {
  it('rejects a non-numeric cursor with CursorExpired', () => {
    const log = new ChangeLog<string, string>();
    expect(() => log.sync('abc', () => true, () => [])).toThrow(CursorExpired);
  });

  it('null cursor returns the snapshot as a full resync', () => {
    const log = new ChangeLog<string, string>();
    log.record('k', 'a');
    expect(log.sync(null, () => true, () => ['snap'])).toEqual({ changes: ['snap'], nextCursor: '1', fullResync: true });
  });

  it('returns only changes newer than the cursor', () => {
    const log = new ChangeLog<string, string>();
    log.record('k', 'a');
    const first = log.sync(null, () => true, () => []);
    log.record('k', 'b');
    log.record('other', 'c');
    const next = log.sync(first.nextCursor, (k) => k === 'k', () => []);
    expect(next).toEqual({ changes: ['b'], nextCursor: '3', fullResync: false });
  });
});
