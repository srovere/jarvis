import { useQuery } from '@tanstack/react-query';
import { getEvents, getTaskLists, getTasks, getThread, getToday, searchMail, type MailFilters, type TaskStatus } from './data';
import { dataKeys } from './hooks';

export const useToday = () => useQuery({ queryKey: dataKeys.today, queryFn: getToday });
export const useThread = (accountId: string, threadId: string) =>
  useQuery({ queryKey: dataKeys.thread(accountId, threadId), queryFn: () => getThread(accountId, threadId) });
export const useMailSearch = (filters: MailFilters | null) =>
  useQuery({ queryKey: dataKeys.mail(filters ?? {}), queryFn: () => searchMail(filters ?? {}), enabled: filters !== null });
export const useEvents = (from: string, to: string, enabled: boolean) =>
  useQuery({ queryKey: dataKeys.events(from, to), queryFn: () => getEvents(from, to), enabled });
export const useTasks = (status: TaskStatus) => useQuery({ queryKey: dataKeys.tasks(status), queryFn: () => getTasks(status) });
export const useTaskLists = () => useQuery({ queryKey: dataKeys.taskLists, queryFn: getTaskLists });
