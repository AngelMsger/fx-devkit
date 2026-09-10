import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['test/**/*.test.ts'],
    environment: 'node',
    setupFiles: ['test/setup-env.ts'],
    // e2e cases spawn the built binary and real git many times over.
    testTimeout: 60_000,
  },
});
