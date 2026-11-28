import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// Third-party code is split into vendor chunks so that no chunk is over Vite's 500 kB warning (blocker B7).
// The chunks are loaded together with the page, so behaviour and appearance are unchanged.
function vendorChunk(id: string): string | undefined {
  if (!id.includes('/node_modules/')) return undefined;
  if (/\/node_modules\/(recharts|d3-[^/]+|victory-vendor|internmap|decimal\.js-light|eventemitter3|lodash|react-smooth|recharts-scale|tiny-invariant|fast-equals)\//.test(id)) return 'vendor-charts';
  if (/\/node_modules\/(react|react-dom|scheduler|react-router|react-router-dom|cookie|set-cookie-parser)\//.test(id)) return 'vendor-react';
  if (/\/node_modules\/(@radix-ui|@floating-ui|react-remove-scroll[^/]*|react-style-singleton|use-callback-ref|use-sidecar|aria-hidden|tslib|get-nonce|detect-node-es)\//.test(id)) return 'vendor-ui';
  if (id.includes('/node_modules/lucide-react/')) return 'vendor-icons';
  return 'vendor';
}

// /api is forwarded to the Wethaq API (wethaq-api, port 4000) when running in live mode
export default defineConfig({ plugins: [react()], build: { target: 'es2020', rollupOptions: { output: { manualChunks: vendorChunk } } }, server: { host: '0.0.0.0', watch: { ignored: ['**/fabric/**', '**/wethaq-api/**', '**/chaincode/**'] }, proxy: { '/api': { target: 'http://127.0.0.1:4000', changeOrigin: true } } } });
