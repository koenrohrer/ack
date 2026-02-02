import js from '@eslint/js';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ['src/**/*.ts'],
    ignores: ['src/views/marketplace/webview/**', 'src/views/config-panel/webview/**'],
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
    ignores: ['dist/**', 'node_modules/**', '*.mjs', '**/*.d.ts'],
  }
);
