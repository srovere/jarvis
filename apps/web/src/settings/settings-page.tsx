import { NavLink, Navigate, Outlet, type RouteObject } from 'react-router-dom';
import { cn } from '@/lib/utils';
import { AccountsSettings } from './accounts';
import { AgentSettings } from './agent';
import { PreferencesSettings } from './preferences';

const TABS = [
  { path: 'accounts', label: 'Accounts' },
  { path: 'agent', label: 'AI agent' },
  { path: 'preferences', label: 'Preferences' },
] as const;

function SettingsLayout() {
  return (
    <div className="space-y-4">
      <h1 className="text-xl font-semibold">Settings</h1>
      <nav aria-label="Settings sections" className="flex gap-2 border-b border-neutral-200 pb-2 text-sm">
        {TABS.map((t) => (
          <NavLink key={t.path} to={`/settings/${t.path}`} className={({ isActive }) => cn('rounded-md px-3 py-1', isActive ? 'bg-neutral-100 font-semibold' : 'text-neutral-600')}>
            {t.label}
          </NavLink>
        ))}
      </nav>
      <Outlet />
    </div>
  );
}

export const settingsRoutes: RouteObject = {
  path: '/settings',
  element: <SettingsLayout />,
  children: [
    { index: true, element: <Navigate to="/settings/accounts" replace /> },
    { path: 'accounts', element: <AccountsSettings /> },
    { path: 'agent', element: <AgentSettings /> },
    { path: 'preferences', element: <PreferencesSettings /> },
  ],
};
