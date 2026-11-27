/** Runtime configuration, read from environment variables (see .env.example). */
export interface Config {
  port: number;
  databaseUrl: string;
  jwtSecret: string;
  jwtTtl: string;
  demoRoleSwitch: boolean;
  ledgerMode: 'local' | 'fabric';
  corsOrigin?: string;
  /** Hours before a temporary password issued by an administrator stops working (default 24). */
  tempPasswordHours: number;
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const production = env.NODE_ENV === 'production';
  const jwtSecret = env.JWT_SECRET || (production ? '' : 'wethaq-dev-secret-change-me');
  if (!jwtSecret || (production && jwtSecret.length < 32)) throw new Error('JWT_SECRET must be set to at least 32 characters in production');
  const ledgerMode = (env.LEDGER_MODE || 'local') as Config['ledgerMode'];
  if (!['local', 'fabric'].includes(ledgerMode)) throw new Error('LEDGER_MODE must be local or fabric');
  return {
    port: Number(env.PORT || 4000),
    databaseUrl: env.DATABASE_URL || 'postgres://wethaq:wethaq@127.0.0.1:5434/wethaq',
    jwtSecret,
    jwtTtl: env.JWT_TTL || '8h',
    demoRoleSwitch: env.DEMO_ROLE_SWITCH !== 'false',
    ledgerMode,
    corsOrigin: env.CORS_ORIGIN || undefined,
    tempPasswordHours: Number(env.TEMP_PASSWORD_HOURS || 24)
  };
}
