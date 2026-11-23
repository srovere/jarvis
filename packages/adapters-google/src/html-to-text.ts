import { convert } from 'html-to-text';

/** Converts email HTML to plain text: no line wrapping, no images, links as text only. */
export function htmlToPlainText(html: string): string {
  return convert(html, {
    wordwrap: false,
    selectors: [
      { selector: 'img', format: 'skip' },
      { selector: 'a', options: { ignoreHref: true } },
    ],
  });
}
