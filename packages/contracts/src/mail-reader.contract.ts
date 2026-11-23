import { describe, expect, it } from 'vitest';
import type { MailChange, MailReader, MailThread } from '@jarvis/core';
import { buildMessage, buildThread } from './fixtures';

export interface MailReaderContractSetup {
  reader: MailReader;
  seed(threads: MailThread[]): Promise<void>;
}

const OPTS = { initialWindowDays: 90 };
const upsertIds = (changes: MailChange[]): string[] =>
  changes.flatMap((c) => (c.kind === 'upsert' ? [c.message.id] : []));

export function describeMailReaderContract(name: string, setup: () => Promise<MailReaderContractSetup>): void {
  describe(`MailReader contract: ${name}`, () => {
    it('getThread returns messages in chronological order', async () => {
      const { reader, seed } = await setup();
      await seed([
        buildThread('t1', 'Hola', [
          buildMessage({ id: 'm2', threadId: 't1', from: 'a@y.com', to: ['me@x.com'], minutes: 10 }),
          buildMessage({ id: 'm3', threadId: 't1', from: 'me@x.com', to: ['a@y.com'], minutes: 20 }),
          buildMessage({ id: 'm1', threadId: 't1', from: 'a@y.com', to: ['me@x.com'], minutes: 0 }),
        ]),
      ]);
      const thread = await reader.getThread('t1');
      expect(thread.id).toBe('t1');
      expect(thread.messages.map((m) => m.id)).toEqual(['m1', 'm2', 'm3']);
    });

    it('getThread rejects for an unknown thread', async () => {
      const { reader } = await setup();
      await expect(reader.getThread('does-not-exist')).rejects.toThrow();
    });

    it('listThreads honours maxResults', async () => {
      const { reader, seed } = await setup();
      await seed(
        ['t1', 't2', 't3'].map((id, i) =>
          buildThread(id, 'Hola', [
            buildMessage({ id: `${id}-m1`, threadId: id, from: 'a@y.com', to: ['me@x.com'], minutes: i }),
          ]),
        ),
      );
      const found = await reader.listThreads({ query: '', maxResults: 2 });
      expect(found.length).toBeGreaterThan(0);
      expect(found.length).toBeLessThanOrEqual(2);
    });

    it('sync(null) returns a full resync with a non-empty cursor and the seeded messages', async () => {
      const { reader, seed } = await setup();
      await seed([
        buildThread('t1', 'Hola', [
          buildMessage({ id: 'm1', threadId: 't1', from: 'a@y.com', to: ['me@x.com'], minutes: 0 }),
        ]),
      ]);
      const full = await reader.sync(null, OPTS);
      expect(full.nextCursor).not.toBe('');
      expect(full.fullResync).toBe(true);
      expect(upsertIds(full.changes)).toContain('m1');
    });

    it('sync(nextCursor) without changes returns no changes', async () => {
      const { reader, seed } = await setup();
      await seed([
        buildThread('t1', 'Hola', [
          buildMessage({ id: 'm1', threadId: 't1', from: 'a@y.com', to: ['me@x.com'], minutes: 0 }),
        ]),
      ]);
      const full = await reader.sync(null, OPTS);
      const again = await reader.sync(full.nextCursor, OPTS);
      expect(again.changes).toEqual([]);
      expect(again.fullResync).toBe(false);
    });

    it('sync(cursor) after a new message is seeded contains an upsert for it', async () => {
      const { reader, seed } = await setup();
      const first = await reader.sync(null, OPTS);
      await seed([
        buildThread('t9', 'Nuevo', [
          buildMessage({ id: 'm9', threadId: 't9', from: 'a@y.com', to: ['me@x.com'], minutes: 30 }),
        ]),
      ]);
      const next = await reader.sync(first.nextCursor, OPTS);
      expect(upsertIds(next.changes)).toContain('m9');
    });
  });
}
