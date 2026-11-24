import { describe, expect, it } from 'vitest';
import { EmailAddress } from '../domain/model/email-address';
import { deriveAccountId } from './account-id';

const id = (email: string, taken: string[] = []) => deriveAccountId(EmailAddress.parse(email), new Set(taken));

describe('deriveAccountId', () => {
  it('slugs the local part', () => {
    expect(id('Ana.Lopez+x@example.com')).toBe('ana-lopez-x');
  });
  it('appends -2, -3 when taken', () => {
    expect(id('ana@a.com', ['ana'])).toBe('ana-2');
    expect(id('ana@a.com', ['ana', 'ana-2'])).toBe('ana-3');
  });
  it('starts alphanumeric and falls back to account', () => {
    expect(id('_-ana@a.com')).toBe('ana');
    expect(id('...@a.com')).toBe('account');
    expect(id('...@a.com', ['account'])).toBe('account-2');
  });
});
