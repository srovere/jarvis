import { describe, expect, it } from 'vitest';
import { GOOGLE_SCOPES } from './scopes';

describe('GOOGLE_SCOPES', () => {
  it('is exactly the five allowed scopes', () => {
    expect(GOOGLE_SCOPES).toEqual([
      'https://www.googleapis.com/auth/gmail.readonly',
      'https://www.googleapis.com/auth/gmail.compose',
      'https://www.googleapis.com/auth/calendar.events',
      'https://www.googleapis.com/auth/tasks',
      'https://www.googleapis.com/auth/calendar.calendarlist.readonly',
    ]);
    expect(GOOGLE_SCOPES).toHaveLength(5);
  });

  it('never includes full mail access', () => {
    expect(GOOGLE_SCOPES).not.toContain('https://mail.google.com/');
  });
});
