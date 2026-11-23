import type { DateTime } from 'luxon';

export interface TaskList {
  id: string;
  accountId: string;
  title: string;
  isDefault: boolean;
}

export interface Task {
  id: string;
  accountId: string;
  listId: string;
  title: string;
  notes?: string;
  status: 'open' | 'completed';
  due?: DateTime;
  createdAt?: DateTime;
  updatedAt: DateTime;
  completedAt?: DateTime;
  deleted: boolean;
  raw?: unknown;
}
