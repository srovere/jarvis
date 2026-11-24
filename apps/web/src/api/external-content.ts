// Server text may arrive wrapped as <external_content source="...">...</external_content>
// (see apps/mcp-server/src/tools/external-content.ts). The server escapes only a `<` that starts
// an external_content tag (opening or closing) inside the content, as `&lt;`.
const WRAPPER = /^\s*<external_content\b[^>]*>([\s\S]*)<\/external_content>\s*$/i;
const ESCAPED_TAG_START = /&lt;(?=\s*\/?\s*external_content)/gi;

/** Strips the external_content wrapper and reverses its escaping. The result is for rendering as text only. */
export function plainText(s: string): string {
  const inner = WRAPPER.exec(s)?.[1] ?? s;
  return inner.replace(ESCAPED_TAG_START, '<');
}
