import { Link, Navigate, Outlet, useLocation, type RouteObject } from 'react-router-dom';
import { useSetupStatus } from '@/api/hooks';
import { cn } from '@/lib/utils';
import { AgentStep } from './agent-step';
import { DoneStep } from './done-step';
import { MailStep } from './mail-step';
import { PreferencesStep } from './preferences-step';

const STEPS = [
  { path: 'mail', label: 'Mail & Calendar' },
  { path: 'agent', label: 'AI agent' },
  { path: 'preferences', label: 'Preferences' },
  { path: 'done', label: 'Done' },
] as const;

/** The first incomplete step from the server-side setup state, or `/` when onboarding is finished. */
function Resume() {
  const { data, isPending, isError, error } = useSetupStatus();
  const { search } = useLocation();
  if (isPending) return <p className="text-sm text-neutral-500">Loading…</p>;
  if (isError) return <p role="alert" className="text-sm text-red-700">Could not load setup status: {error.message}</p>;
  // An OAuth result (?connected= / ?error=) always belongs to the mail step, whatever the setup state.
  const params = new URLSearchParams(search);
  if (params.has('error') || params.has('connected')) return <Navigate to={{ pathname: '/onboarding/mail', search }} replace />;
  if (data.accounts === 0) return <Navigate to={{ pathname: '/onboarding/mail', search }} replace />;
  if (data.agent === 'none') return <Navigate to="/onboarding/agent" replace />;
  if (!data.preferencesSaved) return <Navigate to="/onboarding/preferences" replace />;
  return <Navigate to="/" replace />;
}

function StepList() {
  const { data } = useSetupStatus();
  const { pathname } = useLocation();
  const complete: Record<string, boolean> = {
    mail: (data?.accounts ?? 0) > 0,
    agent: (data?.agent ?? 'none') !== 'none',
    preferences: data?.preferencesSaved ?? false,
    done: false,
  };
  return (
    <ol aria-label="Steps" className="space-y-2 text-sm">
      {STEPS.map((s) => {
        const current = pathname === `/onboarding/${s.path}`;
        const mark = current ? '●' : complete[s.path] ? '✓' : '○';
        return (
          <li key={s.path}>
            <Link
              to={`/onboarding/${s.path}`}
              aria-current={current ? 'step' : undefined}
              className={cn('flex gap-2 rounded-md px-2 py-1', current ? 'bg-neutral-100 font-semibold' : 'text-neutral-600')}
            >
              <span aria-hidden="true">{mark}</span>
              {s.label}
            </Link>
          </li>
        );
      })}
    </ol>
  );
}

function Wizard() {
  return (
    <div className="mx-auto grid max-w-4xl grid-cols-[14rem_1fr] gap-8 p-6">
      <aside>
        <img src="/logo.png" alt="" className="mb-3 h-16 w-16 rounded-lg" />
        <h1 className="mb-4 text-xl font-semibold">Set up Jarvis</h1>
        <StepList />
      </aside>
      <main>
        <Outlet />
      </main>
    </div>
  );
}

export const onboardingRoutes: RouteObject = {
  path: '/onboarding',
  element: <Wizard />,
  children: [
    { index: true, element: <Resume /> },
    { path: 'mail', element: <MailStep /> },
    { path: 'agent', element: <AgentStep /> },
    { path: 'preferences', element: <PreferencesStep /> },
    { path: 'done', element: <DoneStep /> },
  ],
};
