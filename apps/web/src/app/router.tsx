import { createBrowserRouter, createMemoryRouter, Navigate, Outlet, type RouteObject } from 'react-router-dom';
import { useSetupStatus } from '@/api/hooks';
import { Button } from '@/components/ui/button';
import { CalendarPage } from '@/calendar/calendar-page';
import { MailPage } from '@/mail/mail-page';
import { ThreadPage } from '@/mail/thread-page';
import { onboardingRoutes } from '@/onboarding/wizard';
import { Placeholder } from '@/pages/placeholder';
import { TasksPage } from '@/tasks/tasks-page';
import { TodayPage } from '@/today/today-page';
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
          { path: '/', element: <TodayPage /> },
          { path: '/mail', element: <MailPage /> },
          { path: '/mail/:accountId/:threadId', element: <ThreadPage /> },
          { path: '/calendar', element: <CalendarPage /> },
          { path: '/tasks', element: <TasksPage /> },
          { path: '/settings/*', element: <Placeholder title="Settings" /> },
        ],
      },
    ],
  },
];

export const createAppRouter = () => createBrowserRouter(routes);
export const createTestRouter = (initialEntries: string[]) => createMemoryRouter(routes, { initialEntries });
