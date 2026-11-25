import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { removeAccount, reconnectUrl, type Account } from '@/api/client';
import { plainText } from '@/api/external-content';
import { queryKeys, useAccounts } from '@/api/hooks';
import { Button } from '@/components/ui/button';
import { Dialog } from '@/components/ui/dialog';
import { messageOf } from '@/onboarding/agent-token';

const CALENDAR_LIST_SCOPE = 'calendar.calendarlist';

function RemoveDialog({ account, onClose }: { account: Account; onClose: () => void }) {
  const qc = useQueryClient();
  const [deleteData, setDeleteData] = useState(false);
  const remove = useMutation({
    mutationFn: () => removeAccount(account.id, deleteData),
    onSuccess: async () => {
      // Removing the last account sends the user back to onboarding through RequireSetup.
      await Promise.all([qc.invalidateQueries({ queryKey: queryKeys.accounts }), qc.invalidateQueries({ queryKey: queryKeys.setup })]);
      onClose();
    },
  });
  return (
    <Dialog title="Remove account" onClose={onClose}>
      <div className="space-y-3 text-sm">
        <p>Remove {plainText(account.email)} from Jarvis? Jarvis will stop syncing it and forget its access tokens.</p>
        <label className="flex items-center gap-2">
          <input type="checkbox" checked={deleteData} onChange={(e) => setDeleteData(e.target.checked)} />
          Also delete synced data
        </label>
        {remove.isError && (
          <p role="alert" className="text-red-700">
            {messageOf(remove.error)}
          </p>
        )}
        <div className="flex gap-2">
          <Button onClick={() => remove.mutate()} disabled={remove.isPending}>
            Remove account
          </Button>
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
        </div>
      </div>
    </Dialog>
  );
}

export function AccountsSettings() {
  const [params] = useSearchParams();
  const accounts = useAccounts();
  const [removing, setRemoving] = useState<Account | null>(null);
  const error = params.get('error');

  return (
    <section className="space-y-4">
      <h2 className="text-lg font-semibold">Accounts</h2>
      {error && (
        <p role="alert" className="text-sm text-red-700">
          {error}
        </p>
      )}
      {params.get('connected') && !error && (
        <p role="status" className="text-sm text-green-800">
          Account connected.
        </p>
      )}
      {accounts.isError ? (
        <p role="alert" className="text-sm text-red-700">
          Could not load accounts: {accounts.error.message}
        </p>
      ) : accounts.isPending ? (
        <p className="text-sm text-neutral-500">Loading…</p>
      ) : (
        <ul className="divide-y divide-neutral-200 rounded-md border border-neutral-200">
          {accounts.data.map((a) => (
            <li key={a.id} className="space-y-1 p-3 text-sm">
              <div className="flex flex-wrap items-center gap-3">
                <span className="font-medium">{plainText(a.email)}</span>
                <span className="rounded bg-neutral-100 px-2 py-0.5 text-xs">{a.status}</span>
                <a className="underline" href={reconnectUrl}>
                  Reconnect
                </a>
                <Button size="sm" variant="outline" aria-label={`Remove ${a.email}`} onClick={() => setRemoving(a)}>
                  Remove
                </Button>
              </div>
              {a.statusDetail && <p className="text-neutral-600">{plainText(a.statusDetail)}</p>}
              {a.missingScopes.some((s) => s.includes(CALENDAR_LIST_SCOPE)) && <p className="text-amber-800">Reconnect to grant calendar list access</p>}
            </li>
          ))}
        </ul>
      )}
      <Button asChild>
        <a href={reconnectUrl}>Add account</a>
      </Button>
      {removing && <RemoveDialog account={removing} onClose={() => setRemoving(null)} />}
    </section>
  );
}
