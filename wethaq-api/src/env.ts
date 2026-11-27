import { existsSync } from 'node:fs';
// Load wethaq-api/.env when it exists (Node 22). Variables already set in the shell take precedence.
if (existsSync('.env')) process.loadEnvFile('.env');
