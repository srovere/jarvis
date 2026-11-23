import { afterEach, expect } from 'vitest';
import { EmailAddress } from '@jarvis/core';
import { describeDraftWriterContract, describeMailReaderContract, FIXTURE_ACCOUNT_ID, T0 } from '@jarvis/contracts';
import { FakeGmail } from './__fixtures__/fake-gmail';
import { GmailAdapter } from './gmail-adapter';

const own = [EmailAddress.parse('me@x.com')];
const fakes: FakeGmail[] = [];

function create(): { fake: FakeGmail; adapter: GmailAdapter } {
  const fake = new FakeGmail({ sendAs: ['me@x.com'], now: () => T0.plus({ hours: 1 }).toMillis(), pageSize: 2 });
  fakes.push(fake);
  return { fake, adapter: new GmailAdapter(fake.asGmail(), FIXTURE_ACCOUNT_ID) };
}

afterEach(() => {
  for (const f of fakes.splice(0)) {
    expect(f.sendSpy).not.toHaveBeenCalled();
    expect(f.draftSendSpy).not.toHaveBeenCalled();
  }
});

describeMailReaderContract('GmailAdapter + FakeGmail', async () => {
  const { fake, adapter } = create();
  return { reader: adapter, seed: async (threads) => fake.seed(threads) };
});

describeDraftWriterContract('GmailAdapter + FakeGmail', async () => {
  const { fake, adapter } = create();
  return { writer: adapter, reader: adapter, seed: async (threads) => fake.seed(threads), own };
});
