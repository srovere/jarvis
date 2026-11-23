import { describe, expect, it } from 'vitest';
import { EmailAddress } from './email-address';
import { InvalidEmailAddress } from '../errors';

describe('EmailAddress', () => {
  it('parses quoted name with angle address and lowercases', () => {
    const e = EmailAddress.parse('"Ana Pérez" <Ana@Example.COM>');
    expect(e.address).toBe('ana@example.com');
    expect(e.name).toBe('Ana Pérez');
  });
  it('parses bare, angle and unquoted-name forms', () => {
    expect(EmailAddress.parse(' a@b.co ').name).toBeUndefined();
    expect(EmailAddress.parse('<a@b.co>').address).toBe('a@b.co');
    expect(EmailAddress.parse('Bob <b@b.co>').name).toBe('Bob');
  });
  it('rejects invalid input', () => {
    expect(() => EmailAddress.parse('not-an-email')).toThrow(InvalidEmailAddress);
  });
  it('equals compares addresses only', () => {
    expect(EmailAddress.parse('A@b.co').equals(EmailAddress.parse('X <a@b.co>'))).toBe(true);
    expect(EmailAddress.parse('a@b.co').equals(EmailAddress.parse('c@b.co'))).toBe(false);
  });
  it('toString includes name when present', () => {
    expect(EmailAddress.parse('Bob <b@b.co>').toString()).toBe('Bob <b@b.co>');
    expect(EmailAddress.parse('b@b.co').toString()).toBe('b@b.co');
  });
});
