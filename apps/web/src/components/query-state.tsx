import type { UseQueryResult } from '@tanstack/react-query';
import { Button } from '@/components/ui/button';

/** Loading and error states (with Retry) shared by the data views; renders `children(data)` once loaded. */
export function QueryState<T>({ query, children }: { query: UseQueryResult<T>; children: (data: T) => React.ReactNode }) {
  if (query.isPending) return <p className="text-sm text-neutral-500">Loading…</p>;
  if (query.isError)
    return (
      <div role="alert" className="flex items-center gap-3 text-sm text-red-700">
        <span>{query.error.message}</span>
        <Button size="sm" variant="outline" onClick={() => void query.refetch()}>
          Retry
        </Button>
      </div>
    );
  return <>{children(query.data)}</>;
}
