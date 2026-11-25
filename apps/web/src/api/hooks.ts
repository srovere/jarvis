import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { getAccounts, getCalendars, getProviders, getSettings, getSetupStatus, getSyncStatus, triggerSync } from './client';

export const queryKeys = {
  setup: ['setup-status'] as const,
  accounts: ['accounts'] as const,
  sync: ['sync-status'] as const,
  providers: (kind: string) => ['providers', kind] as const,
  settings: ['settings'] as const,
  calendars: ['calendars'] as const,
};

export const useSetupStatus = () => useQuery({ queryKey: queryKeys.setup, queryFn: getSetupStatus });
export const useAccounts = () => useQuery({ queryKey: queryKeys.accounts, queryFn: getAccounts });
export const useSyncStatus = (refetchMs = 60_000) =>
  useQuery({ queryKey: queryKeys.sync, queryFn: getSyncStatus, refetchInterval: refetchMs });
export const useProviders = (kind: 'mail' | 'agent') =>
  useQuery({ queryKey: queryKeys.providers(kind), queryFn: () => getProviders(kind) });
export const useSettings = () => useQuery({ queryKey: queryKeys.settings, queryFn: getSettings });
export const useCalendars = () => useQuery({ queryKey: queryKeys.calendars, queryFn: getCalendars });

export function useTriggerSync() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: triggerSync,
    onSuccess: () => qc.invalidateQueries({ queryKey: queryKeys.sync }),
  });
}

/** Query keys of the dashboard data views. */
export const dataKeys = {
  today: ['today'] as const,
  mail: (f: object) => ['mail', f] as const,
  thread: (a: string, t: string) => ['thread', a, t] as const,
  events: (from: string, to: string) => ['events', from, to] as const,
  tasks: (status: string) => ['tasks', status] as const,
  taskLists: ['task-lists'] as const,
};
