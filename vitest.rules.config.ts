import { defineConfig } from 'vitest/config';

// Tests de regles: només s'executen dins `firebase emulators:exec` (npm run test:rules).
export default defineConfig({
  test: {
    environment: 'node',
    include: ['tests/rules/**/*.test.ts'],
    testTimeout: 20_000,
    fileParallelism: false,
  },
});
