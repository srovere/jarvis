import { IANAZone } from 'luxon';
import { z } from 'zod';

const hour = z.number().int().min(0).max(24);

const WorkScheduleSchema = z
  .object({
    startHour: hour.default(9),
    endHour: hour.default(19),
    workDays: z
      .array(z.number().int().min(1).max(7))
      .nonempty()
      .refine((days) => new Set(days).size === days.length, { message: 'workDays must be unique' })
      .default([1, 2, 3, 4, 5]),
  })
  // La ruta del issue ya queda en `workSchedule` por estar anidado en la raíz.
  .refine((s) => s.startHour < s.endHour, { message: 'startHour must be lower than endHour' });

const FocusSchema = z.object({
  titlePrefix: z.string().default('[Focus] '),
  horizonWorkDays: z.number().int().positive().default(5),
  defaultDurationMinutes: z.number().int().positive().default(90),
});

const SyncSchema = z.object({
  intervalMinutes: z.number().int().positive().default(5),
  gmailInitialWindowDays: z.number().int().positive().default(90),
});

const BriefingSchema = z.object({
  maxPriorityEmails: z.number().int().positive().default(10),
});

const EmailSchema = z.object({
  maxBodyChars: z.number().int().positive().default(4000),
});

const McpSchema = z.object({
  bind: z.string().min(1).default('127.0.0.1'),
  port: z.number().int().min(1).max(65535).default(3002),
  tokenFile: z.string().min(1).default('/run/secrets/mcp_token'),
});

const GoogleAccountSchema = z.object({
  id: z.string().regex(/^[a-z0-9][a-z0-9_-]*$/, 'id must match /^[a-z0-9][a-z0-9_-]*$/'),
  provider: z.literal('google'),
  email: z.string().email(),
  /** Ids de calendarios que cuentan como ocupado; por defecto el principal. */
  calendars: z.array(z.string().min(1)).optional(),
});

// Para soportar otro proveedor, agregar su esquema a esta unión discriminada por `provider`.
const AccountSchema = z.discriminatedUnion('provider', [GoogleAccountSchema]);

export const JarvisConfigSchema = z.object({
  timezone: z
    .string()
    .refine((tz) => IANAZone.isValidZone(tz), { message: 'invalid timezone' })
    .default('America/Argentina/Buenos_Aires'),
  workSchedule: WorkScheduleSchema.prefault({}),
  focus: FocusSchema.prefault({}),
  sync: SyncSchema.prefault({}),
  briefing: BriefingSchema.prefault({}),
  email: EmailSchema.prefault({}),
  accounts: z
    .array(AccountSchema)
    .refine((accounts) => new Set(accounts.map((a) => a.id)).size === accounts.length, {
      message: 'account ids must be unique',
    })
    .default([]),
  mcp: McpSchema.prefault({}),
  secretsDir: z.string().min(1).default('/run/secrets'),
  dataDir: z.string().min(1).default('/data'),
});

export type JarvisConfig = z.infer<typeof JarvisConfigSchema>;
