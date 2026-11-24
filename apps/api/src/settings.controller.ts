import { EFFECTIVE_PREFERENCES } from '@jarvis/composition';
import { PreferencesSchema } from '@jarvis/config';
import { TOKENS, type Preferences, type SettingsStore } from '@jarvis/core';
import { BadRequestException, Body, Controller, Get, HttpCode, Inject, Put } from '@nestjs/common';

/** Preferences: time zone, work schedule, focus, sync and briefing. */
@Controller('api/settings')
export class SettingsController {
  constructor(
    @Inject(TOKENS.SettingsStore) private readonly store: SettingsStore,
    @Inject(EFFECTIVE_PREFERENCES) private readonly effective: { load(): Promise<Preferences> },
  ) {}

  /** Database row, else YAML, else defaults. */
  @Get()
  get(): Promise<Preferences> {
    return this.effective.load();
  }

  /** Replaces the preferences; the agent status recorded alongside them is kept. */
  @Put()
  @HttpCode(204)
  async put(@Body() body: unknown): Promise<void> {
    const parsed = PreferencesSchema.safeParse(body);
    if (!parsed.success) {
      const message = parsed.error.issues.map((i) => `${i.path.join('.') || 'body'}: ${i.message}`).join('; ');
      throw new BadRequestException({ error: `Invalid settings: ${message}` });
    }
    const existing = await this.store.load();
    await this.store.save({ ...parsed.data, ...(existing?.agent ? { agent: existing.agent } : {}) });
  }
}
