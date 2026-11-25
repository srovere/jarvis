import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { completeTask, type TaskItem } from '@/api/data';
import { useTaskLists, useTasks } from '@/api/data-hooks';
import { plainText } from '@/api/external-content';
import { useAccounts, useSettings } from '@/api/hooks';
import { QueryState } from '@/components/query-state';
import { Button } from '@/components/ui/button';
import { todayIn } from '@/lib/dates';
import { cn } from '@/lib/utils';
import { CreateTaskDialog } from './create-task-dialog';

type Filter = 'open' | 'overdue' | 'completed';
const FILTERS: { id: Filter; label: string }[] = [
  { id: 'open', label: 'Open' },
  { id: 'overdue', label: 'Overdue' },
  { id: 'completed', label: 'Completed' },
];

export function TasksPage() {
  const qc = useQueryClient();
  const [filter, setFilter] = useState<Filter>('open');
  const [creating, setCreating] = useState(false);
  const settings = useSettings();
  const accounts = useAccounts();
  const lists = useTaskLists();
  // The API only knows open/completed/all: overdue = open tasks due before today, decided here.
  const tasks = useTasks(filter === 'completed' ? 'completed' : 'open');
  const today = todayIn(settings.data?.zone);
  const firstActive = (accounts.data ?? []).find((a) => a.status === 'active')?.id;

  // Task views carry only the list title; its account comes from the task lists (default: first active account).
  const accountOf = (t: TaskItem) =>
    lists.data?.lists.find((l) => plainText(l.title) === plainText(t.list))?.accountId ?? firstActive ?? '';

  const complete = useMutation({
    mutationFn: (t: TaskItem) => completeTask(accountOf(t), t.id),
    onMutate: async (t) => {
      await qc.cancelQueries({ queryKey: ['tasks'] });
      const snapshot = qc.getQueriesData<{ tasks: TaskItem[] }>({ queryKey: ['tasks'] });
      qc.setQueriesData<{ tasks: TaskItem[] }>({ queryKey: ['tasks'] }, (old) => old && { tasks: old.tasks.filter((x) => x.id !== t.id) });
      return { snapshot };
    },
    onError: (_e, _t, ctx) => ctx?.snapshot.forEach(([key, data]) => qc.setQueryData(key, data)),
    onSettled: () => qc.invalidateQueries({ queryKey: ['tasks'] }),
  });

  const visible = (list: TaskItem[]) => (filter === 'overdue' ? list.filter((t) => t.due && t.due.slice(0, 10) < today) : list);

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold">Tasks</h1>
        <Button onClick={() => setCreating(true)}>New task</Button>
      </div>
      <div className="flex gap-2" role="group" aria-label="Filter">
        {FILTERS.map((f) => (
          <Button key={f.id} size="sm" variant={filter === f.id ? 'default' : 'outline'} aria-pressed={filter === f.id} onClick={() => setFilter(f.id)}>
            {f.label}
          </Button>
        ))}
      </div>
      {complete.isError && (
        <p role="alert" className="text-sm text-red-700">
          Could not complete “{plainText(complete.variables.title)}”: {complete.error.message}
        </p>
      )}
      <QueryState query={tasks}>
        {({ tasks: all }) => {
          const list = visible(all);
          return list.length === 0 ? (
            <p className="text-sm text-neutral-500">No tasks.</p>
          ) : (
            <ul className="divide-y divide-neutral-200 rounded-lg border border-neutral-200 bg-white">
              {list.map((t) => (
                <li key={t.id} className="flex items-center gap-3 p-3 text-sm">
                  <input
                    type="checkbox"
                    aria-label={`Complete ${plainText(t.title)}`}
                    checked={filter === 'completed'}
                    disabled={filter === 'completed'}
                    onChange={() => complete.mutate(t)}
                  />
                  <span className={cn(filter === 'completed' && 'line-through text-neutral-500')}>{plainText(t.title)}</span>
                  <span className="ml-auto text-neutral-500">
                    {plainText(t.list)}
                    {t.due ? ` · due ${t.due.slice(0, 10)}` : ''}
                  </span>
                </li>
              ))}
            </ul>
          );
        }}
      </QueryState>
      {creating && <CreateTaskDialog onClose={() => setCreating(false)} />}
    </div>
  );
}
