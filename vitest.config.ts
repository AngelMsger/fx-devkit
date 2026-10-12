import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['test/**/*.test.ts'],
    environment: 'node',
    setupFiles: ['test/setup-env.ts'],
    // e2e cases spawn the built binary and real git many times over. Windows starts
    // processes far more slowly: the same cases take about five times as long there.
    testTimeout: process.platform === 'win32' ? 300_000 : 60_000,
  },
});
