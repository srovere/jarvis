import { TOKENS, type GetSyncStatus, type RequestSync } from '@jarvis/core';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { Inject, Injectable } from '@nestjs/common';
import { z } from 'zod';
import { section } from './format';
import { syncStatusSchema } from './schemas';
import type { ToolGroup } from './tool-group';
import { ToolRunner } from './tool-runner';

/** `get_sync_status`, `trigger_sync`. */
@Injectable()
export class SyncTools implements ToolGroup {
  constructor(
    @Inject(TOKENS.GetSyncStatus) private readonly status: Pick<GetSyncStatus, 'execute'>,
    @Inject(TOKENS.RequestSync) private readonly sync: Pick<RequestSync, 'execute'>,
    private readonly runner: ToolRunner,
  ) {}

  register(server: McpServer): void {
    server.registerTool(
      'get_sync_status',
      {
        title: 'Get sync status',
        description:
          'Per account (except disabled ones): status (active, or needs_reauth when it must be reconnected), the ' +
          'time of its last sync (null if never) and the OAuth scopes the user did not grant. Use it to tell how ' +
          'fresh the synced data is.',
        inputSchema: {},
        outputSchema: { accounts: z.array(syncStatusSchema) },
      },
      () =>
        this.runner.run('get_sync_status', async () => {
          const accounts = await this.status.execute();
          return {
            text: section(
              'Sync status',
              accounts.map((a) => `- ${a.accountId} <${a.email}> ${a.status}, last sync ${a.lastSyncAt ?? 'never'}`),
              'accounts',
            ),
            structured: { accounts },
          };
        }),
    );

    server.registerTool(
      'trigger_sync',
      {
        title: 'Trigger sync',
        description:
          'Ask for an immediate sync of one active account, or of all of them without account_id. The background ' +
          'worker picks the request up within about 30 seconds; this returns right away with the accounts requested. ' +
          'Use get_sync_status afterwards to see when it finished.',
        inputSchema: { account_id: z.string().min(1).optional().describe('Only this (active) account; default all.') },
        outputSchema: { requested: z.array(z.string()) },
      },
      ({ account_id }) =>
        this.runner.run('trigger_sync', async () => {
          const requested = await this.sync.execute(account_id !== undefined ? { accountId: account_id } : {});
          return {
            text: requested.length > 0 ? `Sync requested for: ${requested.join(', ')}` : 'No active accounts to sync.',
            structured: { requested },
          };
        }),
    );
  }
}
