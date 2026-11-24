import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useState } from 'react';
import { RouterProvider, type createBrowserRouter } from 'react-router-dom';

export function App({ router, client }: { router: ReturnType<typeof createBrowserRouter>; client?: QueryClient }) {
  const [qc] = useState(() => client ?? new QueryClient({ defaultOptions: { queries: { retry: false } } }));
  return (
    <QueryClientProvider client={qc}>
      <RouterProvider router={router} />
    </QueryClientProvider>
  );
}
