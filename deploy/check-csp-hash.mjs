// Fails when deploy/Caddyfile's Content-Security-Policy does not allow every inline script in index.html,
// so a change to the theme script cannot silently break the deployed dashboard.
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';

const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
const caddy = readFileSync(new URL('./Caddyfile', import.meta.url), 'utf8');
const inline = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map(m => `'sha256-${createHash('sha256').update(m[1]).digest('base64')}'`);
const missing = inline.filter(h => !caddy.includes(h));
if (missing.length) { console.error(`deploy/Caddyfile CSP is missing ${missing.join(' ')} for the inline script in index.html`); process.exit(1); }
console.log(`deploy/Caddyfile CSP allows the ${inline.length} inline script(s) in index.html`);
