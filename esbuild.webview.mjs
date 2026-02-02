import * as esbuild from 'esbuild';

const watch = process.argv.includes('--watch');

/** @type {esbuild.BuildOptions} */
const config = {
  entryPoints: ['src/views/marketplace/webview/index.tsx'],
  bundle: true,
  outfile: 'dist/webview.js',
  format: 'iife',
  platform: 'browser',
  target: 'es2022',
  sourcemap: true,
  minify: process.argv.includes('--minify'),
  tsconfig: 'tsconfig.webview.json',
};

if (watch) {
  const ctx = await esbuild.context(config);
  await ctx.watch();
  console.log('Watching webview...');
} else {
  await esbuild.build(config);
}
