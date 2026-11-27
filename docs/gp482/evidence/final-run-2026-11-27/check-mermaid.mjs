import { chromium } from '/home/user/roseal3tb/wethaq/node_modules/playwright/index.mjs';
import { readFileSync } from 'node:fs';
const files = process.argv.slice(2);
const browser = await chromium.launch();
const page = await browser.newPage();
await page.setContent('<html><body></body></html>');
await page.addScriptTag({ path: '/tmp/mm/node_modules/mermaid/dist/mermaid.min.js' });
let bad = 0;
for (const f of files) {
  const blocks = [...readFileSync(f, 'utf8').matchAll(/```mermaid\n([\s\S]*?)```/g)].map(m => m[1]);
  for (const [i, code] of blocks.entries()) {
    const r = await page.evaluate(async c => { try { await window.mermaid.parse(c); return 'ok'; } catch (e) { return String(e.message || e).slice(0, 300); } }, code);
    if (r !== 'ok') bad++;
    console.log(f.split('/').pop(), i + 1, r);
  }
}
await browser.close();
process.exit(bad ? 1 : 0);
