import { useMemo, useState } from 'react';
import { Input } from '@/components/ui/input';

const MAX_OPTIONS = 50;

interface ZoneOption {
  id: string;
  label: string;
}

/** `UTC+05:30`-style offset of `zone` right now (daylight saving included). */
function offsetLabel(zone: string, at: Date): string {
  const part = new Intl.DateTimeFormat('en-US', { timeZone: zone, timeZoneName: 'longOffset' })
    .formatToParts(at)
    .find((p) => p.type === 'timeZoneName')?.value;
  const match = /GMT([+-]\d\d:\d\d)/.exec(part ?? '');
  return `UTC${match?.[1] ?? '+00:00'}`;
}

/**
 * "City — Region (UTC±hh:mm)". The IANA database has no country names, so the region is the first
 * segment of the id (`America`, `Europe`, …); a bare id such as `UTC` is shown as is.
 */
export function zoneLabel(zone: string, at = new Date()): string {
  const [region, ...rest] = zone.split('/');
  const city = (rest.length > 0 ? rest[rest.length - 1]! : region!).replace(/_/g, ' ');
  const place = rest.length > 0 ? `${city} — ${region}` : city;
  return `${place} (${offsetLabel(zone, at)})`;
}

export function browserZone(): string {
  return Intl.DateTimeFormat().resolvedOptions().timeZone;
}

function allZones(include: string): ZoneOption[] {
  const ids = new Set(Intl.supportedValuesOf('timeZone'));
  ids.add(include);
  const now = new Date();
  return [...ids].sort().map((id) => ({ id, label: zoneLabel(id, now) }));
}

interface Props {
  id: string;
  value: string;
  onChange: (zone: string) => void;
}

/** Searchable time zone picker; typing filters, choosing an option sets the IANA id. */
export function TimezoneCombobox({ id, value, onChange }: Props) {
  const options = useMemo(() => allZones(value), [value]);
  const [query, setQuery] = useState<string | null>(null);
  const [open, setOpen] = useState(false);

  const selected = options.find((o) => o.id === value);
  const text = query ?? selected?.label ?? value;
  const needle = (query ?? '').trim().toLowerCase().replace(/ /g, '_');
  const shown = (needle === ''
    ? options
    : options.filter((o) => o.id.toLowerCase().includes(needle) || o.label.toLowerCase().includes(needle.replace(/_/g, ' ')))
  ).slice(0, MAX_OPTIONS);

  return (
    <div className="relative">
      <Input
        id={id}
        role="combobox"
        aria-expanded={open}
        aria-controls={`${id}-listbox`}
        aria-autocomplete="list"
        autoComplete="off"
        value={text}
        onFocus={(e) => e.currentTarget.select()}
        onChange={(e) => {
          setQuery(e.target.value);
          setOpen(true);
        }}
        onBlur={() => {
          setOpen(false);
          setQuery(null);
        }}
        onKeyDown={(e) => {
          if (e.key === 'Escape') setOpen(false);
          if (e.key === 'Enter' && open && shown[0]) {
            e.preventDefault();
            onChange(shown[0].id);
            setQuery(null);
            setOpen(false);
          }
        }}
      />
      {open && (
        <ul
          id={`${id}-listbox`}
          role="listbox"
          className="absolute z-10 mt-1 max-h-60 w-full overflow-auto rounded-md border border-neutral-300 bg-white py-1 text-sm shadow"
        >
          {shown.length === 0 && <li className="px-3 py-1 text-neutral-500">No matching time zone</li>}
          {shown.map((o) => (
            <li
              key={o.id}
              role="option"
              aria-selected={o.id === value}
              className="cursor-pointer px-3 py-1 hover:bg-neutral-100"
              // mousedown fires before the input's blur, which would close the list first
              onMouseDown={(e) => {
                e.preventDefault();
                onChange(o.id);
                setQuery(null);
                setOpen(false);
              }}
            >
              {o.label}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
