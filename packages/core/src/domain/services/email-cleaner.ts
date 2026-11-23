import type { MailMessage } from '../model/mail';

export interface EmailCleanerOptions {
  maxChars?: number;
  htmlToText: (html: string) => string;
}

const DEFAULT_MAX_CHARS = 4000;

const QUOTE_HEADERS: RegExp[] = [
  /^On .+wrote:$/,
  /^El .+escribió:$/,
  /^-{2,}\s*(Original Message|Mensaje original)\s*-{2,}/i,
  /^De: .+\nEnviado: /,
];

const MOBILE_SIGNATURE = /^(Enviado desde mi iPhone|Sent from my iPhone)\s*$/i;

const NAMED_ENTITIES: Record<string, string> = {
  quot: '"',
  amp: '&',
  lt: '<',
  gt: '>',
  apos: "'",
};

function decodeEntities(s: string): string {
  return s.replace(/&(?:#(\d+)|(quot|amp|lt|gt|apos));/g, (_m, num?: string, name?: string) =>
    num !== undefined ? String.fromCodePoint(Number(num)) : NAMED_ENTITIES[name as string],
  );
}

export class EmailCleaner {
  private readonly maxChars: number;
  private readonly htmlToText: (html: string) => string;

  constructor(opts: EmailCleanerOptions) {
    this.maxChars = opts.maxChars ?? DEFAULT_MAX_CHARS;
    this.htmlToText = opts.htmlToText;
  }

  clean(m: Pick<MailMessage, 'bodyText' | 'bodyHtml' | 'snippet'>): string {
    const source = m.bodyText?.trim()
      ? m.bodyText
      : m.bodyHtml?.trim()
        ? this.htmlToText(m.bodyHtml)
        : '';
    if (!source) return this.cleanSnippet(m.snippet);

    const lines = source.replace(/\r\n?/g, '\n').split('\n');
    const kept = lines
      .slice(0, this.findCutIndex(lines))
      .filter((line) => !MOBILE_SIGNATURE.test(line.trim()));
    const text = kept
      .join('\n')
      .replace(/\n{3,}/g, '\n\n')
      .trim();

    if (text.length <= this.maxChars) return text;
    return `${text.slice(0, this.maxChars)}\n[… truncado, ${text.length} caracteres en total]`;
  }

  cleanSnippet(s: string): string {
    return decodeEntities(s).trim();
  }

  private findCutIndex(lines: string[]): number {
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      if (line.trimEnd() === '--' || line.startsWith('>')) return i;
      const next = lines[i + 1];
      const wrapped = next === undefined ? line : `${line.trimEnd()} ${next.trim()}`;
      const withNewline = next === undefined ? line : `${line}\n${next}`;
      if (QUOTE_HEADERS.some((re) => re.test(line.trimEnd()) || re.test(wrapped) || re.test(withNewline))) {
        return i;
      }
    }
    return lines.length;
  }
}
