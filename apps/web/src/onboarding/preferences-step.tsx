import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { ApiError, putAccountCalendars, putSettings } from '@/api/client';
import { queryKeys, useAccounts, useCalendars, useSettings, useSetupStatus } from '@/api/hooks';
import { browserZone } from './timezone-combobox';
import { PreferencesForm, type PreferencesSubmit } from './preferences-form';

export function PreferencesStep() {
  const qc = useQueryClient();
  const navigate = useNavigate();
  const setup = useSetupStatus();
  const settings = useSettings();
  const accounts = useAccounts();
  const calendars = useCalendars();

  const save = useMutation({
    mutationFn: async ({ preferences, busy }: PreferencesSubmit) => {
      await putSettings(preferences);
      for (const [accountId, ids] of Object.entries(busy)) await putAccountCalendars(accountId, ids);
    },
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: queryKeys.setup });
      await qc.invalidateQueries({ queryKey: queryKeys.accounts });
      navigate('/onboarding/done');
    },
  });

  const loading = setup.isPending || settings.isPending || accounts.isPending || calendars.isPending;
  const failed = setup.error ?? settings.error ?? accounts.error;

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
        <PreferencesForm
          initial={setup.data!.preferencesSaved ? settings.data! : { ...settings.data!, zone: browserZone() }}
          accounts={accounts.data!.filter((a) => a.status === 'active')}
          calendars={calendars.data?.calendars ?? null}
          submitLabel="Finish setup"
          pending={save.isPending}
          error={save.isError ? (save.error instanceof ApiError ? save.error.message : 'Could not save. Try again.') : null}
          onSubmit={(v) => save.mutate(v)}
        />
      )}
    </section>
  );
}
