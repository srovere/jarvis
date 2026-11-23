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

  since(cursor: string, match: (key: K) => boolean): C[] {
    const after = Number(cursor);
    return this.entries.filter((e) => e.version > after && match(e.key)).map((e) => e.change);
  }
}
