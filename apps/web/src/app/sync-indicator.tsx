import { useSyncStatus } from '@/api/hooks';

/** Latest `lastSyncAt` across accounts, or null when nothing has synced yet. */
export function latestSync(lastSyncs: (string | null)[]): Date | null {
  const times = lastSyncs.filter((s): s is string => !!s).map((s) => new Date(s).getTime());
  return times.length ? new Date(Math.max(...times)) : null;
}

export function syncLabel(last: Date | null, now: Date = new Date()): string {
  if (!last) return 'never synced';
  const minutes = Math.max(0, Math.floor((now.getTime() - last.getTime()) / 60_000));
  return `synced ${minutes} min ago`;
}

export function SyncIndicator() {
  const { data } = useSyncStatus();
  const last = latestSync((data?.accounts ?? []).map((a) => a.lastSyncAt));
  return <span className="text-sm text-neutral-500">{syncLabel(last)}</span>;
}
