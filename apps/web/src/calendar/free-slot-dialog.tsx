import { useMutation } from '@tanstack/react-query';
import { useState } from 'react';
import { findFreeSlot } from '@/api/data';
import { Button } from '@/components/ui/button';
import { Dialog } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { fmtSlot } from '@/lib/dates';

/** Read-only: shows the first free slot within work hours. Nothing is reserved. */
export function FreeSlotDialog({ onClose }: { onClose: () => void }) {
  const [duration, setDuration] = useState('90');
  const find = useMutation({ mutationFn: () => findFreeSlot(Number(duration)) });
  return (
    <Dialog title="Find free slot" onClose={onClose}>
      <form
        className="space-y-3"
        onSubmit={(e) => {
          e.preventDefault();
          find.mutate();
        }}
      >
        <label className="block space-y-1 text-sm">
          <span>Duration (minutes)</span>
          <Input type="number" min={15} max={480} value={duration} onChange={(e) => setDuration(e.target.value)} />
        </label>
        <Button type="submit" disabled={find.isPending}>
          Find
        </Button>
      </form>
      {find.isError && (
        <p role="alert" className="text-sm text-red-700">
          {find.error.message}
        </p>
      )}
      {find.isSuccess && (
        <p className="text-sm">{find.data.slot ? fmtSlot(find.data.slot) : 'No free slot within the search horizon.'}</p>
      )}
    </Dialog>
  );
}
