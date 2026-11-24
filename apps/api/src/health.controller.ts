import { Controller, Get } from '@nestjs/common';

/** Liveness probe. */
@Controller('api/health')
export class HealthController {
  @Get()
  check(): { status: 'ok' } {
    return { status: 'ok' };
  }
}
