import { CursorExpired } from '../domain/errors';
import type { SyncResult } from '../domain/ports/mail';

/** Monotonic versioned log; the cursor handed to callers is the version as a string. */
export class ChangeLog<K, C> {
  private version = 0;
  private readonly entries: { version: number; key: K; change: C }[] = [];

  record(key: K, change: C): void {
    this.entries.push({ version: ++this.version, key, change });
  }

  get currentCursor(): string {
    return String(this.version);
  }

  /** `null` cursor: full resync from `snapshot`; otherwise the matching changes after the cursor version. */
  sync(cursor: string | null, match: (key: K) => boolean, snapshot: () => C[]): SyncResult<C> {
    const nextCursor = this.currentCursor;
    if (cursor === null) return { changes: snapshot(), nextCursor, fullResync: true };
    if (!/^\d+$/.test(cursor)) throw new CursorExpired(`Invalid cursor: ${cursor}`);
    const after = Number(cursor);
    const changes = this.entries.filter((e) => e.version > after && match(e.key)).map((e) => e.change);
    return { changes, nextCursor, fullResync: false };
  }
}
