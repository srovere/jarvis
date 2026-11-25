import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { useAccounts } from '@/api/hooks';
import { AccountSelector } from '@/components/account-selector';
import { blockFocus, findFreeSlot, type Slot } from '@/api/data';
import { Button } from '@/components/ui/button';
import { Dialog } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { fmtSlot } from '@/lib/dates';

/** Blocking focus time creates a real calendar event, so the proposed slot must be confirmed explicitly first. */
export function FocusDialog({ onClose }: { onClose: () => void }) {
  const qc = useQueryClient();
  const [name, setName] = useState('');
  const [duration, setDuration] = useState('90');
  const [accountId, setAccountId] = useState('');
  const accounts = useAccounts();
  const active = (accounts.data ?? []).filter((a) => a.status === 'active');
  const chosen = active.length > 1 ? (accountId || active[0]!.id) : '';
  const chosenEmail = active.find((a) => a.id === chosen)?.email;
  const [slot, setSlot] = useState<Slot | null | undefined>(undefined);
  const find = useMutation({ mutationFn: () => findFreeSlot(Number(duration)), onSuccess: (r) => setSlot(r.slot) });
  const block = useMutation({
    mutationFn: () => blockFocus(name.trim(), Number(duration), slot ? Number(slot.start.slice(11, 13)) : undefined, chosen || undefined),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['events'] }),
  });
  const reset = () => {
    setSlot(undefined);
    block.reset();
  };

  return (
    <Dialog title="Block focus time" onClose={onClose}>
      <div className="space-y-3">
        <label className="block space-y-1 text-sm">
          <span>Name</span>
          <Input value={name} onChange={(e) => (setName(e.target.value), reset())} />
        </label>
        <label className="block space-y-1 text-sm">
          <span>Duration (minutes)</span>
          <Input type="number" min={15} max={480} value={duration} onChange={(e) => (setDuration(e.target.value), reset())} />
        </label>
        <AccountSelector value={chosen} onChange={(id) => (setAccountId(id), reset())} />
        {slot === undefined && (
          <Button disabled={!name.trim() || find.isPending} onClick={() => find.mutate()}>
            Find a slot
          </Button>
        )}
        {slot === null && <p className="text-sm">No free slot within the search horizon.</p>}
        {slot && !block.isSuccess && (
          <div className="space-y-2">
            <p className="text-sm">
              Proposed slot: <strong>{fmtSlot(slot)}</strong>. This will create a calendar event{chosenEmail ? ` in ${chosenEmail}` : ''}.
            </p>
            <Button disabled={block.isPending} onClick={() => block.mutate()}>
              Confirm and block
            </Button>
          </div>
        )}
        {block.isSuccess && (
          <p className="text-sm">
            {block.data.status === 'no_slot'
              ? 'No free slot fits any more; nothing was blocked.'
              : `${block.data.status === 'already_exists' ? 'A focus block already exists' : 'Focus time blocked'}: ${block.data.start && block.data.end ? fmtSlot({ start: block.data.start, end: block.data.end }) : ''}`}
            {slot && block.data.start && block.data.end && block.data.start !== slot.start && block.data.status !== 'no_slot' && (
              <span className="mt-1 block font-medium text-amber-700">
                Note: this differs from the slot shown ({fmtSlot(slot)}); check your calendar.
              </span>
            )}
          </p>
        )}
        {(find.isError || block.isError) && (
          <p role="alert" className="text-sm text-red-700">
            {(find.error ?? block.error)?.message}
          </p>
        )}
      </div>
    </Dialog>
  );
}
