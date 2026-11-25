import { useQueryClient } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { queryKeys, useAccounts, useSetupStatus, useSyncStatus } from '@/api/hooks';
import { Button } from '@/components/ui/button';

const SYNC_POLL_MS = 3000;

export function DoneStep() {
  const qc = useQueryClient();
  const navigate = useNavigate();
  const setup = useSetupStatus();
  const accounts = useAccounts();
  const sync = useSyncStatus(SYNC_POLL_MS);
  const active = (accounts.data ?? []).filter((a) => a.status === 'active');
  const rows = sync.data?.accounts.filter((a) => active.some((x) => x.id === a.accountId)) ?? [];

  async function goToDashboard() {
    await qc.invalidateQueries({ queryKey: queryKeys.setup });
    navigate('/');
  }

  return (
    <section className="space-y-4">
      <h2 className="text-lg font-semibold">All set</h2>
      <ul className="space-y-1 text-sm">
        <li>Accounts: {active.length}</li>
        <li>Agent: {setup.data?.agent === 'connected' ? 'connected' : setup.data?.agent === 'skipped' ? 'skipped (connect it later in Settings)' : (setup.data?.agent ?? '…')}</li>
      </ul>
      <div>
        <h3 className="text-sm font-medium">First sync</h3>
        <ul className="space-y-1 text-sm text-neutral-700">
          {rows.map((r) => (
            <li key={r.accountId}>{`${r.email} — ${r.lastSyncAt ? 'synced' : 'syncing…'}`}</li>
          ))}
        </ul>
      </div>
      <Button onClick={() => void goToDashboard()}>Go to dashboard</Button>
    </section>
  );
}
