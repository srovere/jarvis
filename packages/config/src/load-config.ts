import { existsSync, readFileSync } from 'node:fs';
import { parse } from 'yaml';
import { z } from 'zod';
import { JarvisConfigSchema, type JarvisConfig } from './schema';

const ENV_PREFIX = 'JARVIS__';

type RawObject = Record<string, unknown>;

function isRecord(value: unknown): value is RawObject {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** Atraviesa wrappers (default/optional/prefault/pipe) hasta llegar al esquema base. */
function unwrap(schema: z.ZodType): z.ZodType {
  let current: z.ZodType = schema;
  for (;;) {
    const def = current._zod.def as { innerType?: z.ZodType; in?: z.ZodType };
    const next = def.innerType ?? def.in;
    if (!next) return current;
    current = next;
  }
}

function shapeOf(schema: z.ZodType): Record<string, z.ZodType> | undefined {
  const base = unwrap(schema);
  return base instanceof z.ZodObject ? (base.shape as Record<string, z.ZodType>) : undefined;
}

function parseValue(raw: string): unknown {
  try {
    return JSON.parse(raw);
  } catch {
    return raw;
  }
}

function applyOverride(root: RawObject, name: string, value: unknown): void {
  const segments = name.slice(ENV_PREFIX.length).split('__');
  let target = root;
  let schema: z.ZodType = JarvisConfigSchema;
  segments.forEach((segment, index) => {
    const shape = shapeOf(schema);
    const key = shape && Object.keys(shape).find((k) => k.toLowerCase() === segment.toLowerCase());
    if (!shape || !key) {
      throw new Error(`Invalid config override ${name}: unknown key "${segment}"`);
    }
    schema = shape[key] as z.ZodType;
    if (index === segments.length - 1) {
      if (unwrap(schema) instanceof z.ZodObject) {
        throw new Error(`Invalid config override ${name}: "${key}" is a section, set one of its keys`);
      }
      if (Array.isArray(value) && value.some(isRecord)) {
        throw new Error(`Invalid config override ${name}: arrays of objects cannot be set from env`);
      }
      target[key] = value;
      return;
    }
    if (!shapeOf(schema)) {
      throw new Error(`Invalid config override ${name}: "${key}" cannot be overridden from env`);
    }
    const existing = target[key];
    const child: RawObject = isRecord(existing) ? existing : {};
    target[key] = child;
    target = child;
  });
}

export function loadConfig(path: string, env: NodeJS.ProcessEnv): JarvisConfig {
  if (!existsSync(path)) {
    throw new Error(`Config file not found: ${path}`);
  }
  const parsed: unknown = parse(readFileSync(path, 'utf8')) ?? {};
  if (!isRecord(parsed)) {
    throw new Error(`Invalid config file ${path}: top level must be a mapping`);
  }
  const raw = structuredClone(parsed);
  for (const name of Object.keys(env).sort()) {
    const value = env[name];
    if (name.toUpperCase().startsWith(ENV_PREFIX) && value !== undefined) {
      applyOverride(raw, name, parseValue(value));
    }
  }
  const result = JarvisConfigSchema.safeParse(raw);
  if (!result.success) {
    const issues = result.error.issues.map((i) => `${i.path.join('.') || '(root)'}: ${i.message}`);
    throw new Error(`Invalid configuration in ${path}:\n${issues.join('\n')}`);
  }
  return result.data;
}
