import { useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useThread } from '@/api/data-hooks';
import { plainText } from '@/api/external-content';
import { QueryState } from '@/components/query-state';
import { Button } from '@/components/ui/button';
import { DraftDialog } from './draft-dialog';

export function ThreadPage() {
  const { accountId = '', threadId = '' } = useParams();
  const query = useThread(accountId, threadId);
  const [replying, setReplying] = useState(false);

  return (
    <div className="space-y-4">
      <Link to="/mail" className="text-sm text-neutral-600 hover:underline">
        ← Back to search
      </Link>
      <QueryState query={query}>
        {(thread) => (
          <>
            <div className="flex items-start justify-between gap-4">
              <h1 className="text-xl font-semibold">{plainText(thread.subject)}</h1>
              <Button onClick={() => setReplying(true)}>Reply</Button>
            </div>
            <ol className="space-y-3">
              {thread.messages.map((m) => (
                <li key={m.id} className="rounded-lg border border-neutral-200 bg-white p-4">
                  <div className="text-sm text-neutral-500">
                    {plainText(m.from)} · {m.date.slice(0, 16).replace('T', ' ')}
                  </div>
                  <pre className="mt-2 whitespace-pre-wrap font-sans text-sm">{plainText(m.body)}</pre>
                </li>
              ))}
            </ol>
            {replying && <DraftDialog threadId={thread.threadId} onClose={() => setReplying(false)} />}
          </>
        )}
      </QueryState>
    </div>
  );
}
