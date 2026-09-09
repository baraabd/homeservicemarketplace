import js from '@eslint/js';
import globals from 'globals';
import tseslint from 'typescript-eslint';
import reactHooks from 'eslint-plugin-react-hooks';
import reactRefresh from 'eslint-plugin-react-refresh';
import eslintConfigPrettier from 'eslint-config-prettier';

export default tseslint.config(
  {
    ignores: [
      '**/node_modules/**',
      '**/dist/**',
      '**/build/**',
      '**/coverage/**',
      '**/.turbo/**',
      '**/.next/**',
      '**/generated/**',
      '**/*.d.ts',
      // Sprint 09B.29 — build outputs that live beside `dist` rather than in
      // it, because two Playwright configurations must not share one output
      // directory. `**/dist/**` does not cover them, and without these the
      // web package linted its own minified bundle: 4,034 errors in generated
      // code, which buries the 35 real warnings the gate exists to watch.
      '**/dist-realapi/**',
      '**/dist-phase2-e2e/**',
      // Phase 3 adds three more, for the same reason: proving a BUILD-TIME
      // feature flag needs two web bundles that cannot overwrite each other,
      // and the API serving them cannot share an output with either the
      // developer's watcher or the still-running Phase 2 build.
      '**/dist-phase3-e2e/**',
      '**/dist-phase3-v2/**',
      '**/dist-phase3-v1/**',
      // Third-party assets vendored byte-for-byte so the visual gate is
      // deterministic (lucide, floating-ui, the font stylesheet). They are
      // pinned upstream builds recorded with SHA-256 in `manifest.json`;
      // linting them would report on code this repository must not edit.
      'apps/web/e2e/assets/vendor/**',
    ],
  },

  js.configs.recommended,
  ...tseslint.configs.recommended,
  eslintConfigPrettier,

  {
    // Sprint 09B.29 — Node scripts under `e2e/` that carry in-page callbacks.
    //
    // `diff-regions.mjs` runs in Node but its comparison body is handed to
    // `page.evaluate()` and executes in Chromium, so `document` and `Image`
    // are legitimately in scope there. Node globals stay available because the
    // script's own body reads files and argv.
    files: ['apps/web/e2e/**/*.mjs'],
    languageOptions: {
      globals: {
        ...globals.node,
        ...globals.browser,
      },
    },
  },

  {
    files: ['apps/web/**/*.{ts,tsx}'],
    languageOptions: {
      globals: {
        ...globals.browser,
      },
    },
    plugins: {
      'react-hooks': reactHooks,
      'react-refresh': reactRefresh,
    },
    rules: {
      ...reactHooks.configs.recommended.rules,

      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ],
      '@typescript-eslint/no-unused-expressions': 'error',
      '@typescript-eslint/ban-ts-comment': [
        'error',
        {
          'ts-ignore': false,
          'ts-expect-error': 'allow-with-description',
        },
      ],

      'react-hooks/set-state-in-effect': 'warn',
      'react-hooks/purity': 'warn',
      'react-hooks/static-components': 'warn',
      'react-hooks/exhaustive-deps': 'warn',

      'react-refresh/only-export-components': ['warn', { allowConstantExport: true }],
    },
  },

  {
    files: ['apps/api/**/*.ts', 'packages/**/*.ts'],
    languageOptions: {
      globals: {
        ...globals.node,
      },
    },
    rules: {
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ],
      '@typescript-eslint/no-unused-expressions': 'error',
    },
  },

  // CommonJS config files (jest.config.cjs, etc.) — Node globals,
  // no TS type-checking rules apply. .cjs files legitimately use
  // require() so the TS-eslint rule that bans require imports is
  // disabled for this glob.
  {
    files: ['**/*.{js,cjs,mjs}'],
    languageOptions: {
      globals: {
        ...globals.node,
      },
    },
    rules: {
      '@typescript-eslint/no-require-imports': 'off',
    },
  },
);
