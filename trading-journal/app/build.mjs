// Baut die App in eine einzige HTML-Datei (../index.html), die als claude.ai-Artifact veröffentlicht wird.
import { build } from 'esbuild';
import { execSync } from 'node:child_process';
import fs from 'node:fs';

fs.mkdirSync('dist', { recursive: true });
await build({
  entryPoints: ['src/main.tsx'],
  bundle: true,
  minify: true,
  format: 'iife',
  target: 'es2020',
  jsx: 'automatic',
  outfile: 'dist/app.js',
  define: { 'process.env.NODE_ENV': '"production"' },
  legalComments: 'none',
});
execSync('npx @tailwindcss/cli -i src/styles.css -o dist/app.css --minify', { stdio: 'inherit' });

const js = fs.readFileSync('dist/app.js', 'utf8').replace(/<\/script/gi, '<\\/script');
const css = fs.readFileSync('dist/app.css', 'utf8');
const html = fs.readFileSync('src/template.html', 'utf8')
  .replace('/*CSS*/', () => css)
  .replace('/*JS*/', () => js);
fs.writeFileSync('../index.html', html);
console.log(`index.html: ${(html.length / 1024).toFixed(0)} KB`);
