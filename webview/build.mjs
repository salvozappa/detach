import * as esbuild from 'esbuild';
import { copyFileSync, mkdirSync } from 'fs';

mkdirSync('dist', { recursive: true });

// Copy CSS from node_modules
copyFileSync('node_modules/@xterm/xterm/css/xterm.css', 'dist/xterm.css');
copyFileSync('node_modules/diff2html/bundles/css/diff2html.min.css', 'dist/diff2html.css');
copyFileSync('node_modules/highlight.js/styles/github-dark.css', 'dist/highlight.css');

const isWatch = process.argv.includes('--watch');
const ctx = await esbuild.context({
  entryPoints: ['src/app.ts'],
  bundle: true,
  outfile: 'dist/app.js',
  sourcemap: true,
  target: ['es2020'],
  format: 'iife',
  minify: process.env.NODE_ENV === 'production',
});

if (isWatch) {
  await ctx.watch();
  console.log('Watching for changes...');
} else {
  await ctx.rebuild();
  await ctx.dispose();
}
