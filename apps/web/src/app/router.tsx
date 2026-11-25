import { createBrowserRouter, createMemoryRouter, Navigate, Outlet, type RouteObject } from 'react-router-dom';
import { useSetupStatus } from '@/api/hooks';
import { Button } from '@/components/ui/button';
import { onboardingRoutes } from '@/onboarding/wizard';
import { Placeholder } from '@/pages/placeholder';
import { Shell } from './shell';

/** Sends the user to /onboarding until an account exists and preferences are saved. */
export function RequireSetup() {
  const { data, isPending, isError, error, refetch } = useSetupStatus();
  if (isPending) return <p className="p-6 text-sm text-neutral-500">Loading…</p>;
  if (isError)
    return (
      <div role="alert" className="flex items-center gap-3 p-6 text-sm text-red-700">
        <span>Could not load setup status: {error.message}</span>
        <Button size="sm" variant="outline" onClick={() => void refetch()}>
          Retry
        </Button>
      </div>
    );
  if (data.accounts === 0 || !data.preferencesSaved) return <Navigate to="/onboarding" replace />;
  return <Outlet />;
}

export const routes: RouteObject[] = [
  onboardingRoutes,
  {
    element: <RequireSetup />,
    children: [
      {
        element: <Shell />,
        children: [
          { path: '/', element: <Placeholder title="Today" /> },
          { path: '/mail', element: <Placeholder title="Mail" /> },
          { path: '/mail/:accountId/:threadId', element: <Placeholder title="Thread" /> },
          { path: '/calendar', element: <Placeholder title="Calendar" /> },
          { path: '/tasks', element: <Placeholder title="Tasks" /> },
          { path: '/settings/*', element: <Placeholder title="Settings" /> },
        ],
      },
    ],
  },
];

export const createAppRouter = () => createBrowserRouter(routes);
export const createTestRouter = (initialEntries: string[]) => createMemoryRouter(routes, { initialEntries });
