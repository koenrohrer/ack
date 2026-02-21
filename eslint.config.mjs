import js from '@eslint/js';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ['src/**/*.ts'],
    ignores: ['src/views/marketplace/webview/**', 'src/views/config-panel/webview/**', 'src/test/**'],
    languageOptions: {
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
    rules: {
      '@typescript-eslint/no-unused-vars': ['warn', { argsIgnorePattern: '^_' }],
      '@typescript-eslint/no-explicit-any': 'warn',
    },
  },
  // Adapter boundary guard: prevent direct adapter imports outside adapter directories
  {
    files: ['src/**/*.ts'],
    ignores: [
      'src/adapters/claude-code/**',
      'src/adapters/codex/**',
      'src/adapters/copilot/**',
      'src/extension.ts',
      'src/test/**',
      'src/views/marketplace/webview/**',
      'src/views/config-panel/webview/**',
    ],
    rules: {
      'no-restricted-imports': ['error', {
        patterns: [
          {
            group: ['**/adapters/claude-code/*', '**/adapters/claude-code/**'],
            message: 'Do not import claude-code modules directly. Use IPlatformAdapter methods via AdapterRegistry.',
          },
          {
            group: ['**/adapters/codex/*', '**/adapters/codex/**'],
            message: 'Do not import codex modules directly. Use IPlatformAdapter methods via AdapterRegistry.',
          },
          {
            group: ['**/adapters/copilot/*', '**/adapters/copilot/**'],
            message: 'Do not import copilot modules directly. Use IPlatformAdapter methods via AdapterRegistry.',
          },
        ],
      }],
    },
  },
  {
    files: [
      'src/views/marketplace/webview/**/*.ts',
      'src/views/marketplace/webview/**/*.tsx',
      'src/views/config-panel/webview/**/*.ts',
      'src/views/config-panel/webview/**/*.tsx',
    ],
    languageOptions: {
      parserOptions: {
        project: 'tsconfig.webview.json',
        tsconfigRootDir: import.meta.dirname,
      },
    },
    rules: {
      '@typescript-eslint/no-unused-vars': ['warn', { argsIgnorePattern: '^_' }],
      '@typescript-eslint/no-explicit-any': 'warn',
    },
  },
  {
    files: ['src/test/**/*.ts'],
    rules: {
      '@typescript-eslint/no-unused-vars': 'off',
      '@typescript-eslint/no-unsafe-function-type': 'off',
      '@typescript-eslint/no-explicit-any': 'off',
    },
  },
  {
    ignores: ['dist/**', 'node_modules/**', '*.mjs', '**/*.d.ts'],
  }
);
