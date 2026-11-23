import type { MailMessage } from "../model/mail";

export interface EmailCleanerOptions {
  maxChars?: number;
  htmlToText: (html: string) => string;
}

const DEFAULT_MAX_CHARS = 4000;

const ATTRIBUTION_HEADERS: RegExp[] = [/^On .+wrote:$/, /^El .+escribió:$/];

const HARD_HEADERS: RegExp[] = [
  /^-{2,}\s*(Original Message|Mensaje original)\s*-{2,}/i,
  /^De: .+\nEnviado: /,
];

const MOBILE_SIGNATURE = /^(Enviado desde mi iPhone|Sent from my iPhone)\s*$/i;

const NAMED_ENTITIES: Record<string, string> = {
  quot: '"',
  amp: "&",
  lt: "<",
  gt: ">",
  apos: "'",
  nbsp: " ",
};

function decodeCodePoint(code: number, original: string): string {
  const valid =
    code >= 0 && code <= 0x10ffff && !(code >= 0xd800 && code <= 0xdfff);
  return valid ? String.fromCodePoint(code) : original;
}

function decodeEntities(s: string): string {
  return s.replace(
    /&(?:#(\d+)|#[xX]([0-9a-fA-F]+)|(quot|amp|lt|gt|apos|nbsp));/g,
    (m, dec?: string, hex?: string, name?: string) => {
      if (dec !== undefined) return decodeCodePoint(Number(dec), m);
      if (hex !== undefined) return decodeCodePoint(parseInt(hex, 16), m);
      return NAMED_ENTITIES[name as string];
    },
  );
}

export class EmailCleaner {
  private readonly maxChars: number;
  private readonly htmlToText: (html: string) => string;

  constructor(opts: EmailCleanerOptions) {
    this.maxChars = opts.maxChars ?? DEFAULT_MAX_CHARS;
    this.htmlToText = opts.htmlToText;
  }

  clean(m: Pick<MailMessage, "bodyText" | "bodyHtml" | "snippet">): string {
    const source = m.bodyText?.trim()
      ? m.bodyText
      : m.bodyHtml?.trim()
        ? this.htmlToText(m.bodyHtml)
        : "";
    if (!source) return this.cleanSnippet(m.snippet);

    const lines = source.replace(/\r\n?/g, "\n").split("\n");
    const kept = lines
      .slice(0, this.findCutIndex(lines))
      .filter(
        (line) =>
          !MOBILE_SIGNATURE.test(line.trim()) &&
          !line.trimStart().startsWith(">"),
      );
    const text = kept
      .join("\n")
      .replace(/\n{3,}/g, "\n\n")
      .trim();

    if (!text) return this.cleanSnippet(m.snippet);
    if (text.length <= this.maxChars) return text;
    return `${text.slice(0, this.maxChars)}\n[… truncado, ${text.length} caracteres en total]`;
  }

  cleanSnippet(s: string): string {
    return decodeEntities(s).trim();
  }

  private findCutIndex(lines: string[]): number {
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      if (line.trimEnd() === "--") return i;
      const next = lines[i + 1];
      const single = line.trimEnd();
      const wrapped =
        next === undefined ? undefined : `${single} ${next.trim()}`;
      if (
        HARD_HEADERS.some(
          (re) =>
            re.test(single) ||
            (next !== undefined && re.test(`${line}\n${next}`)),
        )
      ) {
        return i;
      }
      if (ATTRIBUTION_HEADERS.some((re) => re.test(single))) {
        if (this.isAttribution(single, lines, i + 1)) return i;
      } else if (
        wrapped !== undefined &&
        ATTRIBUTION_HEADERS.some((re) => re.test(wrapped)) &&
        this.isAttribution(wrapped, lines, i + 2)
      ) {
        return i;
      }
    }
    return lines.length;
  }

  private isAttribution(
    header: string,
    lines: string[],
    nextIndex: number,
  ): boolean {
    if (header.includes("@")) return true;
    const following = lines.slice(nextIndex).find((l) => l.trim() !== "");
    return following !== undefined && following.trimStart().startsWith(">");
  }
}
