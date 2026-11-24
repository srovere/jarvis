const CLOSE = '</external_content>';
/** `<` starting an `external_content` tag (opening or closing), so content cannot break out of its wrapper. */
const TAG_START = /<(?=\s*\/?\s*external_content)/gi;

function wrap(source: 'email' | 'calendar', text: string): string {
  return `<external_content source="${source}">${text.replace(TAG_START, '&lt;')}${CLOSE}`;
}

/** Wraps untrusted email text (subject, sender, body or snippet) so the model reads it as data, never as instructions. */
export function emailContent(text: string): string {
  return wrap('email', text);
}

/** Wraps untrusted calendar text (event titles can come from third-party invitations). */
export function calendarContent(text: string): string {
  return wrap('calendar', text);
}
