import js from '@eslint/js';
import globals from 'globals';
import reactHooks from 'eslint-plugin-react-hooks';
import reactRefresh from 'eslint-plugin-react-refresh';
import tseslint from 'typescript-eslint';
import { defineConfig, globalIgnores } from 'eslint/config';

const unusedVars = ['error', { argsIgnorePattern: '^_', varsIgnorePattern: '^_', destructuredArrayIgnorePattern: '^_', caughtErrors: 'none' }];

export default defineConfig([
  globalIgnores(['dist', 'dist-electron', 'dist-server', 'release', 'node_modules', 'playwright-report', 'test-results', 'coverage']),
  {
    files: ['src/**/*.{ts,tsx}'],
    extends: [js.configs.recommended, tseslint.configs.recommended, reactHooks.configs.flat.recommended, reactRefresh.configs.vite],
    languageOptions: { ecmaVersion: 2022, globals: globals.browser },
    rules: { '@typescript-eslint/no-unused-vars': unusedVars },
  },
  {
    files: ['shared/**/*.ts'],
    extends: [js.configs.recommended, tseslint.configs.recommended],
    languageOptions: { ecmaVersion: 2022, globals: { ...globals.es2022 } },
    rules: { '@typescript-eslint/no-unused-vars': unusedVars },
  },
  {
    files: ['server/**/*.ts', 'api/**/*.ts', 'electron/**/*.ts', 'scripts/**/*.{js,mjs,ts}', '*.config.{js,ts}'],
    extends: [js.configs.recommended, tseslint.configs.recommended],
    languageOptions: { ecmaVersion: 2022, globals: globals.node },
    rules: { '@typescript-eslint/no-unused-vars': unusedVars },
  },
  {
    files: ['tests/**/*.{ts,tsx}', 'e2e/**/*.{ts,tsx}'],
    extends: [js.configs.recommended, tseslint.configs.recommended],
    languageOptions: { ecmaVersion: 2022, globals: { ...globals.node, ...globals.browser } },
    rules: { '@typescript-eslint/no-unused-vars': unusedVars },
  },
  {
    // Harnais E2E du connecteur local : page React (mêmes règles des hooks que le site).
    files: ['e2e/connector-harness/**/*.tsx'],
    extends: [reactHooks.configs.flat.recommended],
    languageOptions: { globals: globals.browser },
  },
]);
