/** Composition-level tokens (adapter or config types that `core` must not know about). */
export const DB = Symbol('Db');
export const JARVIS_CONFIG = Symbol('JarvisConfig');
/** `boolean`: whether a YAML configuration file exists (when not, `JARVIS_CONFIG` holds the schema defaults). */
export const JARVIS_CONFIG_PRESENT = Symbol('JarvisConfigPresent');
/** `(line: string) => void` sink for structured (JSON) log lines; stderr in production. */
/** `{ status(): Promise<'present' | 'missing'> }`: whether a Google OAuth client was uploaded (or configured). */
export const GOOGLE_CLIENT_STATUS = Symbol('GoogleClientStatus');
export interface GoogleClientStatus {
  status(): Promise<'present' | 'missing'>;
}
export const LOG_SINK = Symbol('LogSink');

export type LogSink = (line: string) => void;

export const stderrLogSink: LogSink = (line) => {
  process.stderr.write(`${line}\n`);
};
