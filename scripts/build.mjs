// Production build: bundles content script / service worker / popup / options with esbuild and
// copies static assets into dist/. Load dist/ via chrome://extensions → Load unpacked.
import { build, context } from 'esbuild';
import { cpSync, mkdirSync, rmSync, existsSync, readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { execFileSync } from 'node:child_process';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const dist = join(root, 'dist');
const watch = process.argv.includes('--watch');
const dev = watch || process.argv.includes('--dev');

if (!existsSync(join(root, 'public/icons/icon128.png'))) {
  execFileSync(process.execPath, [join(root, 'scripts/make-icons.mjs')], { stdio: 'inherit' });
}

rmSync(dist, { recursive: true, force: true });
mkdirSync(dist, { recursive: true });

const common = {
  bundle: true,
  format: 'iife', // content scripts can't use ES module imports → everything is bundled
  target: 'chrome111',
  minify: !dev,
  sourcemap: dev ? 'inline' : false,
  legalComments: 'none',
  loader: { '.css': 'text' },
  logLevel: 'info',
};
const entries = {
  'content/index': 'src/content/index.js',
  'background/service-worker': 'src/background/service-worker.js',
  'popup/popup': 'src/popup/popup.js',
  'options/options': 'src/options/options.js',
  'preview/preview': 'src/preview/preview.js',
  'domain/domain': 'src/domain/domain.js',
};
const opts = { ...common, entryPoints: Object.fromEntries(Object.entries(entries).map(([k, v]) => [k, join(root, v)])), outdir: dist };

function copyStatic() {
  const manifest = JSON.parse(readFileSync(join(root, 'manifest.json'), 'utf8'));
  const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
  manifest.version = pkg.version;
  writeFileSync(join(dist, 'manifest.json'), JSON.stringify(manifest, null, 2));
  cpSync(join(root, 'public/icons'), join(dist, 'icons'), { recursive: true });
  for (const f of ['popup/popup.html', 'popup/popup.css', 'options/options.html', 'options/options.css', 'preview/preview.html', 'domain/domain.html', 'domain/domain.css']) {
    mkdirSync(dirname(join(dist, f)), { recursive: true });
    cpSync(join(root, 'src', f), join(dist, f));
  }
}

copyStatic();
if (watch) {
  const ctx = await context(opts);
  await ctx.watch();
  console.log('Watching… (static assets are copied once; re-run build after editing HTML/CSS)');
} else {
  await build(opts);
  console.log('\n✔ Built to', dist);
}
