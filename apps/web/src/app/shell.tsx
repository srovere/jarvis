import { NavLink, Outlet } from 'react-router-dom';
import { useTriggerSync } from '@/api/hooks';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { ReauthBanner } from './reauth-banner';
import { SyncIndicator } from './sync-indicator';

const NAV = [
  { to: '/', label: 'Today', end: true },
  { to: '/mail', label: 'Mail', end: false },
  { to: '/calendar', label: 'Calendar', end: false },
  { to: '/tasks', label: 'Tasks', end: false },
  { to: '/settings', label: 'Settings', end: false },
];

export function Shell() {
  const sync = useTriggerSync();
  return (
    <div className="flex h-screen bg-neutral-50 text-neutral-900">
      <nav aria-label="Main" className="flex w-48 shrink-0 flex-col gap-1 border-r border-neutral-200 bg-white p-3">
        <div className="mb-3 flex items-center gap-2 px-3 text-lg font-semibold">
          <img src="/logo.png" alt="" className="h-8 w-8 rounded-md" />
          Jarvis
        </div>
        {NAV.map((item) => (
          <NavLink
            key={item.to}
            to={item.to}
            end={item.end}
            className={({ isActive }) =>
              cn('rounded-md px-3 py-2 text-sm', isActive ? 'bg-neutral-900 text-white' : 'hover:bg-neutral-100')
            }
          >
            {item.label}
          </NavLink>
        ))}
      </nav>
      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex items-center justify-end gap-3 border-b border-neutral-200 bg-white px-4 py-2">
          <SyncIndicator />
          <Button size="sm" variant="outline" disabled={sync.isPending} onClick={() => sync.mutate()}>
            Sync now
          </Button>
          {sync.isError && (
            <span role="status" className="text-sm text-red-700">
              {sync.error.message}
            </span>
          )}
        </header>
        <ReauthBanner />
        <div className="flex min-h-0 flex-1">
          <main className="min-w-0 flex-1 overflow-auto p-6">
            <Outlet />
          </main>
          {/* Reserved for the phase-3 chat panel. */}
          <aside aria-label="Chat" data-testid="chat-region" className="hidden w-80 shrink-0 border-l border-neutral-200 xl:block" />
        </div>
      </div>
    </div>
  );
}
