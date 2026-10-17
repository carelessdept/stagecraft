import { mkdir, copyFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const docsDir = path.join(root, 'docs');
const assetsDir = path.join(docsDir, 'assets');

await mkdir(assetsDir, { recursive: true });

await build({
  entryPoints: [path.join(root, 'src', 'main.ts')],
  outfile: path.join(assetsDir, 'app.js'),
  bundle: true,
  format: 'esm',
  target: ['es2022'],
  minify: true,
  sourcemap: false,
});

await copyFile(path.join(root, 'src', 'index.html'), path.join(docsDir, 'index.html'));
await copyFile(path.join(root, 'src', 'styles.css'), path.join(docsDir, 'styles.css'));
