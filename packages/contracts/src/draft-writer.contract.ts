import { describe, expect, it } from 'vitest';
import type { DraftWriter, EmailAddress, MailReader, MailThread } from '@jarvis/core';
import { addr, buildMessage, buildThread } from './fixtures';

export interface DraftWriterContractSetup {
  writer: DraftWriter;
  reader: MailReader;
  seed(threads: MailThread[]): Promise<void>;
  /** Addresses of the connected account; the first one is used as the fixtures' own address. */
  own: EmailAddress[];
}

const addresses = (list: EmailAddress[]): string[] => list.map((a) => a.address);

export function describeDraftWriterContract(name: string, setup: () => Promise<DraftWriterContractSetup>): void {
  describe(`DraftWriter contract: ${name}`, () => {
    it('replies to the last sender, never to an own address, with Re: prefix', async () => {
      const { writer, reader, seed, own } = await setup();
      const me = own[0]!.address;
      await seed([
        buildThread('t1', 'Hola', [
          buildMessage({ id: 'm1', threadId: 't1', from: 'a@y.com', to: [me], minutes: 0 }),
        ]),
      ]);
      expect((await reader.getThread('t1')).id).toBe('t1');
      const ref = await writer.createDraft({ threadId: 't1', body: 'ok' });
      expect(addresses(ref.to)).toEqual(['a@y.com']);
      expect(ref.subject).toBe('Re: Hola');
      expect(ref.threadId).toBe('t1');
      expect(ref.draftId).not.toBe('');
    });

    it('does not duplicate the Re: prefix', async () => {
      const { writer, seed, own } = await setup();
      await seed([
        buildThread('t1', 'Re: Hola', [
          buildMessage({ id: 'm1', threadId: 't1', from: 'a@y.com', to: [own[0]!.address], minutes: 0, subject: 'Re: Hola' }),
        ]),
      ]);
      const ref = await writer.createDraft({ threadId: 't1', body: 'ok' });
      expect(ref.subject).toBe('Re: Hola');
      expect(ref.subject).not.toMatch(/^Re:\s*Re:/i);
    });

    it('when the last message is from an own address, replies to a non-own recipient', async () => {
      const { writer, seed, own } = await setup();
      const me = own[0]!.address;
      await seed([
        buildThread('t1', 'Hola', [
          buildMessage({ id: 'm1', threadId: 't1', from: 'b@y.com', to: [me], minutes: 0 }),
          buildMessage({ id: 'm2', threadId: 't1', from: me, to: ['b@y.com'], minutes: 5 }),
        ]),
      ]);
      const ref = await writer.createDraft({ threadId: 't1', body: 'ok' });
      expect(addresses(ref.to)).toEqual(['b@y.com']);
      for (const o of own) expect(addresses(ref.to)).not.toContain(o.address);
    });

    it('uses the explicit recipients and subject when given', async () => {
      const { writer } = await setup();
      const ref = await writer.createDraft({ to: [addr('c@y.com')], subject: 'Asunto', body: 'hola' });
      expect(addresses(ref.to)).toEqual(['c@y.com']);
      expect(ref.subject).toBe('Asunto');
    });

    it('rejects a draft without recipients and without a thread', async () => {
      const { writer } = await setup();
      await expect(writer.createDraft({ body: 'x' })).rejects.toThrow();
    });
  });
}
