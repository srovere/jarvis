import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { createTask } from '@/api/data';
import { useTaskLists } from '@/api/data-hooks';
import { plainText } from '@/api/external-content';
import { useAccounts } from '@/api/hooks';
import { AccountSelector } from '@/components/account-selector';
import { Button } from '@/components/ui/button';
import { Dialog } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Select } from '@/components/ui/select';

export function CreateTaskDialog({ onClose }: { onClose: () => void }) {
  const qc = useQueryClient();
  const accounts = useAccounts();
  const lists = useTaskLists();
  const [title, setTitle] = useState('');
  const [due, setDue] = useState('');
  const [accountId, setAccountId] = useState('');
  const [listId, setListId] = useState('');
  // Lists of the chosen account; with no explicit choice that is the first active account (the API's default).
  const activeId = (accounts.data ?? []).find((a) => a.status === 'active')?.id;
  const effectiveAccount = accountId || activeId;
  const accountLists = (lists.data?.lists ?? []).filter((l) => l.accountId === effectiveAccount);
  const create = useMutation({
    mutationFn: () =>
      createTask({
        title: title.trim(),
        ...(due ? { due } : {}),
        ...(accountId ? { accountId } : {}),
        ...(listId && accountLists.some((l) => l.id === listId) ? { listId } : {}),
      }),
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
        <AccountSelector
          value={accountId}
          onChange={(id) => {
            setAccountId(id);
            setListId('');
          }}
          allLabel="Default account"
        />
        <label className="block space-y-1 text-sm">
          <span>List</span>
          <Select value={listId} onChange={(e) => setListId(e.target.value)}>
            <option value="">Default list</option>
            {accountLists.map((l) => (
              <option key={l.id} value={l.id}>
                {plainText(l.title)}
              </option>
            ))}
          </Select>
        </label>
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
