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
        // `games` is intentionally not registered — `enabledGames` is not
        // enforced anywhere else, so re-registering it would mean a subcommand
        // that does nothing. When `enabledGames` enforcement lands, drop this
        // exclude and add a real test.
        'src/commands/admin/games.ts',
      ],
      // Show every matched file in the text report, including ones already
      // at 100% coverage. Without this, files with full coverage are
      // silently omitted and their per-line numbers are invisible.
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
