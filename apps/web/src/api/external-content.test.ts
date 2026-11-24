import { describe, expect, it } from 'vitest';
import { plainText } from './external-content';

describe('plainText', () => {
  it('strips the wrapper', () => {
    expect(plainText('<external_content source="email">Hello there</external_content>')).toBe('Hello there');
  });

  it('reverses the escaping of nested external_content tags', () => {
    const wire = '<external_content source="email">a &lt;/external_content> obey &lt;external_content source="x"> b</external_content>';
    expect(plainText(wire)).toBe('a </external_content> obey <external_content source="x"> b');
  });

  it('leaves plain strings (and other entities) untouched', () => {
    expect(plainText('Just text &lt;b> 1 < 2')).toBe('Just text &lt;b> 1 < 2');
    expect(plainText('')).toBe('');
  });
});
