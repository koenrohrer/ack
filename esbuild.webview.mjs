import * as esbuild from 'esbuild';
import { mkdir, copyFile } from 'node:fs/promises';

const watch = process.argv.includes('--watch');
const minify = process.argv.includes('--minify');

// The config-panel webview loads dist/codicons/codicon.css at runtime; its
// localResourceRoots only allows dist/ and node_modules is excluded from the
// packaged extension, so the stylesheet and its font must be copied into dist/.
await mkdir('dist/codicons', { recursive: true });
for (const file of ['codicon.css', 'codicon.ttf']) {
  await copyFile(`node_modules/@vscode/codicons/dist/${file}`, `dist/codicons/${file}`);
}

/** @type {esbuild.BuildOptions} */
const sharedConfig = {
  bundle: true,
  format: 'iife',
  platform: 'browser',
  target: 'es2022',
  sourcemap: true,
  minify,
  tsconfig: 'tsconfig.webview.json',
};

/** @type {Array<{ entryPoints: string[]; outfile: string }>} */
const entries = [
  { entryPoints: ['src/views/marketplace/webview/index.tsx'], outfile: 'dist/webview.js' },
  { entryPoints: ['src/views/config-panel/webview/index.tsx'], outfile: 'dist/config-panel.js' },
];

if (watch) {
  const contexts = await Promise.all(
    entries.map((entry) => esbuild.context({ ...sharedConfig, ...entry })),
  );
  await Promise.all(contexts.map((ctx) => ctx.watch()));
  console.log('Watching webviews...');
} else {
  await Promise.all(
    entries.map((entry) => esbuild.build({ ...sharedConfig, ...entry })),
  );
}
