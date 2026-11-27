/** Runtime configuration, read from environment variables (see .env.example). */
export interface Config {
  port: number;
  databaseUrl: string;
  jwtSecret: string;
  jwtTtl: string;
  /** Demonstration role switching (POST /auth/switch). Always off when NODE_ENV=production. */
  demoRoleSwitch: boolean;
  /** Demonstration tools (POST /demo/invalid). Always off when NODE_ENV=production. */
  demoTools: boolean;
  ledgerMode: 'local' | 'fabric';
  corsOrigin?: string;
  /** Hours before a temporary password issued by an administrator stops working (default 24). */
  tempPasswordHours: number;
  production: boolean;
  /** Background reconciliation of pending ledger operations, in milliseconds (0 = off). */
  reconcileIntervalMs: number;
  /** An operation whose transaction id the ledger still does not know after this long is treated as never committed. */
  pendingExpiryMs: number;
}

const WEAK_SECRETS = ['wethaq-dev-secret-change-me', 'change-me-to-a-long-random-string'];

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const production = env.NODE_ENV === 'production';
  const jwtSecret = env.JWT_SECRET || (production ? '' : 'wethaq-dev-secret-change-me');
  if (production && (jwtSecret.length < 32 || WEAK_SECRETS.includes(jwtSecret))) throw new Error('JWT_SECRET must be set to a random value of at least 32 characters in production');
  const ledgerMode = (env.LEDGER_MODE || 'local') as Config['ledgerMode'];
  if (!['local', 'fabric'].includes(ledgerMode)) throw new Error('LEDGER_MODE must be local or fabric');
  if (production && env.DEMO_PASSWORD) throw new Error('DEMO_PASSWORD must not be set in production: demonstration accounts are for local demonstrations only');
  const corsOrigin = env.CORS_ORIGIN || undefined;
  if (corsOrigin && corsOrigin !== '*' && !/^https?:\/\/[^/\s]+$/.test(corsOrigin)) throw new Error('CORS_ORIGIN must be an origin such as https://example.com');
  if (corsOrigin === '*') throw new Error('CORS_ORIGIN=* is not allowed: name the dashboard origin');
  return {
    port: Number(env.PORT || 4000),
    databaseUrl: env.DATABASE_URL || 'postgres://wethaq:wethaq@127.0.0.1:5434/wethaq',
    jwtSecret,
    jwtTtl: env.JWT_TTL || '8h',
    demoRoleSwitch: !production && env.DEMO_ROLE_SWITCH !== 'false',
    demoTools: !production && env.DEMO_TOOLS !== 'false',
    ledgerMode,
    corsOrigin,
    tempPasswordHours: Number(env.TEMP_PASSWORD_HOURS || 24),
    production,
    reconcileIntervalMs: Number(env.RECONCILE_INTERVAL_MS ?? 30_000),
    pendingExpiryMs: Number(env.PENDING_EXPIRY_MS ?? 5 * 60_000)
  };
}
