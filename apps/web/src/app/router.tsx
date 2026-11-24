import { createBrowserRouter, createMemoryRouter, Navigate, Outlet, type RouteObject } from 'react-router-dom';
import { useSetupStatus } from '@/api/hooks';
import { Placeholder } from '@/pages/placeholder';
import { Shell } from './shell';

/** Sends the user to /onboarding until an account exists and preferences are saved. */
export function RequireSetup() {
  const { data, isPending, isError } = useSetupStatus();
  if (isPending) return <p className="p-6 text-sm text-neutral-500">Loading…</p>;
  if (isError) return <p className="p-6 text-sm text-red-700">Could not reach the Jarvis API.</p>;
  if (data.accounts === 0 || !data.preferencesSaved) return <Navigate to="/onboarding" replace />;
  return <Outlet />;
}

export const routes: RouteObject[] = [
  { path: '/onboarding/*', element: <Placeholder title="Onboarding" /> },
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
