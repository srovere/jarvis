import { useMutation, useQueryClient } from '@tanstack/react-query';
import { putAccountCalendars, putSettings } from '@/api/client';
import { queryKeys, useAccounts, useCalendars, useSettings } from '@/api/hooks';
import { messageOf } from '@/onboarding/agent-token';
import { PreferencesForm, type PreferencesSubmit } from '@/onboarding/preferences-form';

export function PreferencesSettings() {
  const qc = useQueryClient();
  const settings = useSettings();
  const accounts = useAccounts();
  const calendars = useCalendars();

  const save = useMutation({
    mutationFn: async ({ preferences, busy }: PreferencesSubmit) => {
      await putSettings(preferences);
      for (const [accountId, ids] of Object.entries(busy)) {
        const current = accounts.data?.find((a) => a.id === accountId)?.busyCalendars ?? [];
        const same = current.length === ids.length && current.every((c) => ids.includes(c));
        if (!same) await putAccountCalendars(accountId, ids);
      }
    },
    onSuccess: () => Promise.all([qc.invalidateQueries({ queryKey: queryKeys.settings }), qc.invalidateQueries({ queryKey: queryKeys.accounts })]),
  });

  const failed = settings.error ?? accounts.error;
  const loading = settings.isPending || accounts.isPending || calendars.isPending;
  return (
    <section className="space-y-4">
      <h2 className="text-lg font-semibold">Preferences</h2>
      {failed ? (
        <p role="alert" className="text-sm text-red-700">
          Could not load your settings: {failed.message}
        </p>
      ) : loading ? (
        <p className="text-sm text-neutral-500">Loading…</p>
      ) : (
        <>
          <PreferencesForm
            initial={settings.data!}
            accounts={accounts.data!.filter((a) => a.status === 'active')}
            calendars={calendars.data?.calendars ?? null}
            submitLabel="Save"
            pending={save.isPending}
            error={save.isError ? messageOf(save.error) : null}
            onSubmit={(v) => save.mutate(v)}
          />
          {save.isSuccess && (
            <p role="status" className="text-sm text-green-800">
              Saved
            </p>
          )}
        </>
      )}
    </section>
  );
}
