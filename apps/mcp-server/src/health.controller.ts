import { Controller, Get } from '@nestjs/common';

/** Liveness probe; no authentication. */
@Controller('health')
export class HealthController {
  @Get()
  check(): { status: 'ok' } {
    return { status: 'ok' };
  }
}
