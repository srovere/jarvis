import { InvalidEmailAddress } from '../errors';

const ADDRESS_RE = /^[^\s@<>"]+@[^\s@<>"]+\.[^\s@<>"]+$/;

export class EmailAddress {
  private constructor(
    readonly address: string,
    readonly name?: string,
  ) {}

  static parse(raw: string): EmailAddress {
    const input = raw.trim();
    const m = /^(.*?)<([^<>]*)>$/.exec(input);
    const addr = (m ? m[2]! : input).trim().toLowerCase();
    if (!ADDRESS_RE.test(addr)) throw new InvalidEmailAddress(`Invalid email address: ${raw}`);
    const name = m ? m[1]!.trim().replace(/^"(.*)"$/, '$1').trim() : '';
    return new EmailAddress(addr, name || undefined);
  }

  equals(o: EmailAddress): boolean {
    return this.address === o.address;
  }

  toString(): string {
    return this.name ? `${this.name} <${this.address}>` : this.address;
  }
}
