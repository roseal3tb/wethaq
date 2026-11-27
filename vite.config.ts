import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
// /api is forwarded to the Wethaq API (wethaq-api, port 4000) when running in live mode
export default defineConfig({ plugins: [react()], build: { target: 'es2020' }, server: { host: '0.0.0.0', watch: { ignored: ['**/fabric/**', '**/wethaq-api/**', '**/chaincode/**'] }, proxy: { '/api': { target: 'http://127.0.0.1:4000', changeOrigin: true } } } });
