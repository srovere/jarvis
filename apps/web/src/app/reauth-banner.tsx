import { reconnectUrl } from '@/api/client';
import { useAccounts } from '@/api/hooks';

export function ReauthBanner() {
  const { data } = useAccounts();
  const stale = (data ?? []).filter((a) => a.status === 'needs_reauth');
  if (stale.length === 0) return null;
  return (
    <div role="alert" className="border-b border-amber-300 bg-amber-50 px-4 py-2 text-sm text-amber-900">
      <p className="font-medium">These accounts need to be reconnected:</p>
      <ul className="mt-1 space-y-1">
        {stale.map((a) => (
          <li key={a.id} className="flex items-center gap-3">
            <span>{a.email}</span>
            <a className="font-medium underline" href={reconnectUrl}>
              Reconnect
            </a>
          </li>
        ))}
      </ul>
    </div>
  );
}
