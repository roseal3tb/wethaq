import '../env.js';
import { loadConfig } from '../config.js';
import { migrate, postgres } from '../db.js';

const db = postgres(loadConfig().databaseUrl);
try {
  const applied = await migrate(db);
  console.log(applied.length ? `Applied: ${applied.join(', ')}` : 'Database is up to date');
} finally { await db.close(); }
