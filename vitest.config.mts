import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: [
      'src/test/unit/**/*.test.ts',
      'src/providers/**/*.test.ts',
    ],
    // `vscode` only exists inside the extension host. Providers that reach it
    // lazily (`await import('vscode')`) already load here; CopilotProvider
    // value-imports it at module scope and so was previously unimportable from
    // the unit suite. Alias it to an empty stub so its pure, filesystem-only
    // methods can be tested. Inert for every existing test -- nothing else in
    // the unit suite imports a module that value-imports `vscode`.
    alias: {
      vscode: fileURLToPath(new URL('./src/test/unit/helpers/vscode-stub.ts', import.meta.url)),
    },
  },
});
