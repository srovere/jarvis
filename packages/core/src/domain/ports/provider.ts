import type { Account, ProviderKind } from '../model/account';
import type { CalendarReader, EventWriter } from './calendar';
import type { IdentityProvider } from './identity';
import type { DraftWriter, MailReader } from './mail';
import type { TaskReader, TaskWriter } from './tasks';

export interface ProviderCapabilities {
  threads: boolean;
  replyHeaders: boolean;
  sendAsAliases: boolean;
  taskLists: boolean;
  incrementalSync: boolean;
}

export interface ProviderBundle {
  mail?: MailReader & DraftWriter;
  calendar?: CalendarReader & EventWriter;
  tasks?: TaskReader & TaskWriter;
  identity: IdentityProvider;
  capabilities: ProviderCapabilities;
}

export interface ProviderFactory {
  readonly kind: ProviderKind;
  create(account: Account): Promise<ProviderBundle>;
  /** Changes whenever what `create` reads (e.g. the stored token) changed; the registry then rebuilds the bundle. */
  fingerprint?(account: Account): Promise<string>;
}
