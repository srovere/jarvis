const OPEN = '<external_content source="email">';
const CLOSE = '</external_content>';
/** `<` starting an `external_content` tag (opening or closing), so content cannot break out of its wrapper. */
const TAG_START = /<(?=\s*\/?\s*external_content)/gi;

/** Wraps untrusted email text (body or snippet) so the model reads it as data, never as instructions. */
export function emailContent(text: string): string {
  return `${OPEN}${text.replace(TAG_START, '&lt;')}${CLOSE}`;
}
