import { TOKENS, type AccountRepository, type RemoveAccount, type SetBusyCalendars } from '@jarvis/core';
import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Inject,
  NotFoundException,
  Param,
  Put,
  Query,
} from '@nestjs/common';

export interface AccountDto {
  id: string;
  provider: string;
  email: string;
  status: 'active' | 'needs_reauth' | 'disabled';
  statusDetail?: string;
  missingScopes: string[];
  busyCalendars: string[];
}

/** Connected accounts: list, remove and choose busy calendars. */
@Controller('api/accounts')
export class AccountsController {
  constructor(
    @Inject(TOKENS.AccountRepository) private readonly accounts: AccountRepository,
    @Inject(TOKENS.RemoveAccount) private readonly remove: Pick<RemoveAccount, 'execute'>,
    @Inject(TOKENS.SetBusyCalendars) private readonly busy: Pick<SetBusyCalendars, 'execute'>,
  ) {}

  @Get()
  async list(): Promise<AccountDto[]> {
    return (await this.accounts.list()).map((a) => ({
      id: a.id,
      provider: a.provider,
      email: a.email.address,
      status: a.status,
      ...(a.statusDetail !== undefined ? { statusDetail: a.statusDetail } : {}),
      missingScopes: [...a.missingScopes],
      busyCalendars: [...a.busyCalendars],
    }));
  }

  @Delete(':id')
  @HttpCode(204)
  async delete(@Param('id') id: string, @Query('deleteData') deleteData?: string): Promise<void> {
    if (deleteData !== undefined && deleteData !== 'true' && deleteData !== 'false') {
      throw new BadRequestException({ error: 'deleteData must be true or false' });
    }
    await this.requireAccount(id);
    await this.remove.execute(id, { deleteData: deleteData === 'true' });
  }

  @Put(':id/calendars')
  @HttpCode(204)
  async setCalendars(@Param('id') id: string, @Body() body: unknown): Promise<void> {
    const ids = (body as { ids?: unknown } | null)?.ids;
    if (!Array.isArray(ids) || ids.length === 0 || !ids.every((i) => typeof i === 'string' && i.length > 0)) {
      throw new BadRequestException({ error: 'ids must be a non-empty array of calendar ids' });
    }
    await this.requireAccount(id);
    await this.busy.execute(id, ids as string[]);
  }

  private async requireAccount(id: string): Promise<void> {
    if (!(await this.accounts.list()).some((a) => a.id === id)) throw new NotFoundException({ error: 'Account not found' });
  }
}
