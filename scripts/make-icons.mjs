// Renders the LinkLens logo (src/shared/logo.js) to public/icons/icon{16,32,48,128}.png with a transparent
// background, using the locally installed Chrome. Dev-only: the generated PNGs are committed.
//   node scripts/make-icons.mjs        (PREVIEW=/path/preview.png also writes a 512px preview)
import puppeteer from 'puppeteer-core';
import { writeFileSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { logoSvg } from '../src/shared/logo.js';

const outDir = join(dirname(fileURLToPath(import.meta.url)), '..', 'public', 'icons');
mkdirSync(outDir, { recursive: true });
const html = (s) => `<!doctype html><style>html,body{margin:0;background:transparent}svg{display:block}</style>${logoSvg({ size: s })}`;

const browser = await puppeteer.launch({ executablePath: process.env.CHROME_PATH || '/usr/bin/google-chrome', headless: true, args: ['--no-sandbox'] });
try {
  const page = await browser.newPage();
  const shots = [16, 32, 48, 128];
  if (process.env.PREVIEW) shots.push(512);
  for (const s of shots) {
    await page.setViewport({ width: s, height: s, deviceScaleFactor: 1 });
    await page.setContent(html(s));
    const png = await page.screenshot({ omitBackground: true, clip: { x: 0, y: 0, width: s, height: s } });
    if (s === 512) writeFileSync(process.env.PREVIEW, png);
    else { writeFileSync(join(outDir, `icon${s}.png`), png); console.log(`icon${s}.png`); }
  }
} finally { await browser.close(); }
