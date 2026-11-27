/**
 * Structured logging: one JSON object per line on stdout (stderr for errors), so logs can be collected
 * by Docker or any log shipper. Secrets are never logged: values under sensitive keys are redacted.
 * LOG_LEVEL: debug | info | warn | error | silent (default info; silent under Vitest).
 */
const LEVELS = { debug: 10, info: 20, warn: 30, error: 40, silent: 100 } as const;
type Level = keyof typeof LEVELS;
const SENSITIVE = /pass(word)?|secret|token|authorization|cookie|private.?key|credential|signature/i;

function threshold(): number {
  const configured = (process.env.LOG_LEVEL || (process.env.VITEST ? 'silent' : 'info')) as Level;
  return LEVELS[configured] ?? LEVELS.info;
}

export function redact(value: unknown, depth = 0): unknown {
  if (depth > 5 || value === null || typeof value !== 'object') return value;
  if (value instanceof Error) return { name: value.name, message: value.message };
  if (Array.isArray(value)) return value.map(v => redact(v, depth + 1));
  return Object.fromEntries(Object.entries(value as Record<string, unknown>).map(([k, v]) => [k, SENSITIVE.test(k) ? '[redacted]' : redact(v, depth + 1)]));
}

function write(level: Exclude<Level, 'silent'>, event: string, fields: Record<string, unknown> = {}) {
  if (LEVELS[level] < threshold()) return;
  const line = JSON.stringify({ time: new Date().toISOString(), level, event, ...(redact(fields) as Record<string, unknown>) });
  (level === 'error' || level === 'warn' ? process.stderr : process.stdout).write(line + '\n');
}

export const logger = {
  debug: (event: string, fields?: Record<string, unknown>) => write('debug', event, fields),
  info: (event: string, fields?: Record<string, unknown>) => write('info', event, fields),
  warn: (event: string, fields?: Record<string, unknown>) => write('warn', event, fields),
  error: (event: string, fields?: Record<string, unknown>) => write('error', event, fields)
};
