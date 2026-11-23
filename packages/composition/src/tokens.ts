/** Composition-level tokens (adapter or config types that `core` must not know about). */
export const DB = Symbol('Db');
export const JARVIS_CONFIG = Symbol('JarvisConfig');
/** `(line: string) => void` sink for structured (JSON) log lines; stderr in production. */
export const LOG_SINK = Symbol('LogSink');

export type LogSink = (line: string) => void;

export const stderrLogSink: LogSink = (line) => {
  process.stderr.write(`${line}\n`);
};
