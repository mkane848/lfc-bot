import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    coverage: {
      provider: 'v8',
      include: ['src/**/*.ts'],
      exclude: [
        'src/**/*.d.ts',
        'src/db/migrations/**',
        'src/types/**',
        'src/deploy.ts',
      ],
      // Show every matched file, including ones no test imports and ones
      // already at 100%. Without this, they vanish from the report and their
      // numbers are invisible.
      all: true,
      reporter: ['text', 'html'],
      thresholds: {
        statements: 95,
        branches: 90,
        functions: 90,
        lines: 95,
      },
    },
  },
});
