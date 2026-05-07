import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // Use forks pool with increased memory for Node v24 compatibility
    pool: 'forks',
    poolOptions: {
      forks: {
        singleFork: true,
        execArgv: ['--max-old-space-size=2048'],
      },
    },
    include: ['tests/**/*.test.ts'],
    maxConcurrency: 1,
  },
});
