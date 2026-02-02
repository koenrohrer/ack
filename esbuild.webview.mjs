import * as esbuild from 'esbuild';

const watch = process.argv.includes('--watch');
const minify = process.argv.includes('--minify');

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
