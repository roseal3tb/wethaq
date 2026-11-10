import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

// Run the real Wethaq domain tests from /tests in Node
// The previous Lovable scaffold config pointed at unused /src/test files and required a missing jsdom package
export default defineConfig({
  plugins: [react()],
  test: {
    environment: 'node',
    globals: false,
    include: ['tests/**/*.test.ts'],
    exclude: ['node_modules/**', 'dist/**'],
  },
});
