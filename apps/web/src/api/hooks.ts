import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { getAccounts, getSetupStatus, getSyncStatus, triggerSync } from './client';

export const queryKeys = {
  setup: ['setup-status'] as const,
  accounts: ['accounts'] as const,
  sync: ['sync-status'] as const,
};

export const useSetupStatus = () => useQuery({ queryKey: queryKeys.setup, queryFn: getSetupStatus });
export const useAccounts = () => useQuery({ queryKey: queryKeys.accounts, queryFn: getAccounts });
export const useSyncStatus = () =>
  useQuery({ queryKey: queryKeys.sync, queryFn: getSyncStatus, refetchInterval: 60_000 });

export function useTriggerSync() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: triggerSync,
    onSuccess: () => qc.invalidateQueries({ queryKey: queryKeys.sync }),
  });
}
