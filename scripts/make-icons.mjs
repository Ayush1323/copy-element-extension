// Renders the LinkLens toolbar icons from the master glyph (design/logo/glyph-1024.png: the white lens and pointer, transparent
// background) onto a rounded square in each theme's colour, using the locally installed Chrome (canvas, so no extra packages).
// One set per theme (public/icons/themes/<id>/icon{16,32,48,128}.png) plus the default theme at public/icons/icon{...}.png (the manifest's).
// Dev-only: the generated PNGs are committed.
//   node scripts/make-icons.mjs        (PREVIEW=/path/preview.png also writes a 512px preview of the default theme)
import puppeteer from 'puppeteer-core';
import { writeFileSync, readFileSync, mkdirSync, rmSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { THEMES, DEFAULT_THEME, deriveColors } from '../src/shared/themes.js';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const outDir = join(root, 'public', 'icons');
const glyph = readFileSync(join(root, 'design', 'logo', 'glyph-1024.png')).toString('base64');
rmSync(join(outDir, 'themes'), { recursive: true, force: true }); // themes that no longer exist must not leave icons behind
mkdirSync(outDir, { recursive: true });

const browser = await puppeteer.launch({ executablePath: process.env.CHROME_PATH || '/usr/bin/google-chrome', headless: true, args: ['--no-sandbox'] });
try {
  const page = await browser.newPage();
  await page.setContent('<!doctype html><meta charset="utf-8">');
  await page.evaluate(async (b64) => {
    const img = await new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = rej; i.src = `data:image/png;base64,${b64}`; });
    window.__glyph = img;
    /** Tile + glyph at size S. The glyph is shrunk in halving steps first: it keeps the thin parts crisp at 16 px. */
    window.__icon = (S, primary) => {
      let src = window.__glyph, w = src.width;
      while (w / 2 >= S) { const c = document.createElement('canvas'); c.width = c.height = w / 2; const x = c.getContext('2d'); x.imageSmoothingQuality = 'high'; x.drawImage(src, 0, 0, w / 2, w / 2); src = c; w /= 2; }
      const c = document.createElement('canvas'); c.width = c.height = S;
      const x = c.getContext('2d'); x.imageSmoothingQuality = 'high';
      const r = S * 0.215;
      x.beginPath(); x.roundRect(0, 0, S, S, r); x.clip();
      x.fillStyle = primary; x.fillRect(0, 0, S, S);
      x.drawImage(src, 0, 0, S, S);
      return c.toDataURL('image/png').split(',')[1];
    };
  }, glyph);

  for (const theme of THEMES) {
    const { primary } = deriveColors(theme);
    const dir = join(outDir, 'themes', theme.id);
    mkdirSync(dir, { recursive: true });
    const sizes = [16, 32, 48, 128];
    if (process.env.PREVIEW && theme.id === DEFAULT_THEME) sizes.push(512);
    for (const s of sizes) {
      const png = Buffer.from(await page.evaluate((S, p) => window.__icon(S, p), s, primary), 'base64');
      if (s === 512) { writeFileSync(process.env.PREVIEW, png); continue; }
      writeFileSync(join(dir, `icon${s}.png`), png);
      if (theme.id === DEFAULT_THEME) writeFileSync(join(outDir, `icon${s}.png`), png);
    }
    console.log(theme.id);
  }
} finally { await browser.close(); }
