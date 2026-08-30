import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import prettier from 'eslint-config-prettier';

export default [
  {
    ignores: ['dist', 'node_modules', 'drizzle.config.ts', '**/*.js'],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  ...tseslint.configs.recommendedTypeChecked,
  prettier,
  {
    files: ['src/**/*.ts', 'tests/**/*.ts'],
    languageOptions: {
      parser: tseslint.parser,
      parserOptions: {
        ecmaVersion: 'latest',
        sourceType: 'module',
        project: './tsconfig.eslint.json',
      },
      globals: {
        node: 'readonly',
      },
    },
    rules: {
      '@typescript-eslint/no-explicit-any': 'warn',
      '@typescript-eslint/no-unused-vars': [
        'error',
        {
          argsIgnorePattern: '^_',
          varsIgnorePattern: '^_',
        },
      ],
      '@typescript-eslint/explicit-module-boundary-types': 'off',
    },
  },
  {
    // Command-handler tests mock discord.js interactions by intersecting a
    // real interface (e.g. ChatInputCommandInteraction) with vi.fn() mock
    // properties. TypeScript resolves the intersected member's declared
    // shape from the interface's method signature, so accessing it (e.g.
    // `expect(i.deferReply)`) trips these two rules even though the runtime
    // value is a plain mock function, not a bound method. This is the
    // standard vi.fn()-mock-of-an-interface idiom; the alternative (a
    // separate, unintersected mock type per test) would just move the same
    // false positive to a cast at every call site instead of avoiding it.
    files: ['tests/commands/**/*.ts', 'tests/helpers/interaction.ts'],
    rules: {
      '@typescript-eslint/unbound-method': 'off',
      '@typescript-eslint/no-unsafe-assignment': 'off',
    },
  },
];
