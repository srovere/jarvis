import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useMailSearch } from '@/api/data-hooks';
import type { MailFilters } from '@/api/data';
import { plainText } from '@/api/external-content';
import { AccountSelector } from '@/components/account-selector';
import { QueryState } from '@/components/query-state';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';

export function MailPage() {
  const [q, setQ] = useState('');
  const [from, setFrom] = useState('');
  const [after, setAfter] = useState('');
  const [before, setBefore] = useState('');
  const [accountId, setAccountId] = useState('');
  const [filters, setFilters] = useState<MailFilters | null>(null);
  const search = useMailSearch(filters);
  const empty = !q.trim() && !from.trim() && !after && !before;

  function submit(e: React.FormEvent) {
    e.preventDefault();
    if (empty) return;
    const f: MailFilters = { q: q.trim(), from: from.trim(), after, before, accountId };
    setFilters(Object.fromEntries(Object.entries(f).filter(([, v]) => v)) as MailFilters);
  }

  return (
    <div className="space-y-4">
      <h1 className="text-xl font-semibold">Mail</h1>
      <form onSubmit={submit} className="grid max-w-3xl grid-cols-2 gap-3">
        <label className="space-y-1 text-sm">
          <span>Text</span>
          <Input value={q} onChange={(e) => setQ(e.target.value)} />
        </label>
        <label className="space-y-1 text-sm">
          <span>Sender</span>
          <Input value={from} onChange={(e) => setFrom(e.target.value)} />
        </label>
        <label className="space-y-1 text-sm">
          <span>After</span>
          <Input type="date" value={after} onChange={(e) => setAfter(e.target.value)} />
        </label>
        <label className="space-y-1 text-sm">
          <span>Before</span>
          <Input type="date" value={before} onChange={(e) => setBefore(e.target.value)} />
        </label>
        <AccountSelector value={accountId} onChange={setAccountId} allLabel="All accounts" />
        <div className="col-span-2 flex items-center gap-3">
          <Button type="submit" disabled={empty}>
            Search
          </Button>
          {empty && <span className="text-sm text-neutral-500">Enter text, a sender or a date to search.</span>}
        </div>
      </form>
      {filters && (
        <QueryState query={search}>
          {({ emails }) =>
            emails.length === 0 ? (
              <p className="text-sm text-neutral-500">No emails found.</p>
            ) : (
              <ul className="divide-y divide-neutral-200 rounded-lg border border-neutral-200 bg-white">
                {emails.map((m) => (
                  <li key={m.id}>
                    <Link className="block p-3 text-sm hover:bg-neutral-50" to={`/mail/${encodeURIComponent(m.accountId)}/${encodeURIComponent(m.threadId)}`}>
                      <span className="font-medium">{plainText(m.subject)}</span>
                      <span className="block text-neutral-500">
                        {plainText(m.from)} · {m.date.slice(0, 10)}
                      </span>
                    </Link>
                  </li>
                ))}
              </ul>
            )
          }
        </QueryState>
      )}
    </div>
  );
}
