import { GOOGLE_CLIENT_STORE, type GoogleClientStore } from '@jarvis/composition';
import { BadRequestException, Body, Controller, Get, HttpCode, Inject, Put } from '@nestjs/common';

/** The uploaded Google OAuth client (Desktop app JSON); its content is never returned. */
@Controller('api/google/client')
export class GoogleClientController {
  constructor(@Inject(GOOGLE_CLIENT_STORE) private readonly store: GoogleClientStore) {}

  @Get()
  async status(): Promise<{ status: 'present' | 'missing' }> {
    return { status: await this.store.status() };
  }

  @Put()
  @HttpCode(204)
  async upload(@Body() body: unknown): Promise<void> {
    const json = (body as { json?: unknown } | null)?.json;
    if (typeof json !== 'string') throw new BadRequestException({ error: 'json must be a string' });
    await this.store.save(json);
  }
}
