import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { createTask } from '@/api/data';
import { AccountSelector } from '@/components/account-selector';
import { Button } from '@/components/ui/button';
import { Dialog } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';

/** The API creates the task in the default list of the chosen account (no per-list choice). */
export function CreateTaskDialog({ onClose }: { onClose: () => void }) {
  const qc = useQueryClient();
  const [title, setTitle] = useState('');
  const [due, setDue] = useState('');
  const [accountId, setAccountId] = useState('');
  const create = useMutation({
    mutationFn: () => createTask({ title: title.trim(), ...(due ? { due } : {}), ...(accountId ? { accountId } : {}) }),
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: ['tasks'] });
      onClose();
    },
  });
  return (
    <Dialog title="New task" onClose={onClose}>
      <form
        className="space-y-3"
        onSubmit={(e) => {
          e.preventDefault();
          if (title.trim()) create.mutate();
        }}
      >
        <label className="block space-y-1 text-sm">
          <span>Title</span>
          <Input value={title} onChange={(e) => setTitle(e.target.value)} />
        </label>
        <label className="block space-y-1 text-sm">
          <span>Due date</span>
          <Input type="date" value={due} onChange={(e) => setDue(e.target.value)} />
        </label>
        <AccountSelector value={accountId} onChange={setAccountId} allLabel="Default account" />
        {create.isError && (
          <p role="alert" className="text-sm text-red-700">
            {create.error.message}
          </p>
        )}
        <Button type="submit" disabled={!title.trim() || create.isPending}>
          Create
        </Button>
      </form>
    </Dialog>
  );
}
