import { useAccounts } from '@/api/hooks';
import { Select } from '@/components/ui/select';

/** Chooses among the active accounts; renders nothing unless there is more than one. `value` '' means "all/default". */
export function AccountSelector({ value, onChange, allLabel }: { value: string; onChange: (id: string) => void; allLabel?: string }) {
  const { data } = useAccounts();
  const active = (data ?? []).filter((a) => a.status === 'active');
  if (active.length < 2) return null;
  return (
    <Select aria-label="Account" value={value} onChange={(e) => onChange(e.target.value)}>
      {allLabel !== undefined && <option value="">{allLabel}</option>}
      {active.map((a) => (
        <option key={a.id} value={a.id}>
          {a.email}
        </option>
      ))}
    </Select>
  );
}
