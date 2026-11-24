import type { EmailAddress } from '../domain/model/email-address';

/** Stable account id from the local part of the address (`[a-z0-9_-]`), suffixed `-2`, `-3`… until not in `taken`. */
export function deriveAccountId(email: EmailAddress, taken: Set<string>): string {
  const local = email.address.split('@')[0] ?? '';
  const slug = local
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, '-')
    .replace(/^[^a-z0-9]+/, '')
    .replace(/-+$/, '');
  const base = slug === '' ? 'account' : slug;
  if (!taken.has(base)) return base;
  for (let n = 2; ; n++) {
    const candidate = `${base}-${n}`;
    if (!taken.has(candidate)) return candidate;
  }
}
