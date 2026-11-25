// Keeps the default-theme variable block at the top of each stylesheet in sync with src/shared/themes.js.
//   node scripts/sync-theme-css.mjs        (run after changing DEFAULT_THEME or a theme's colours; `npm test` fails if it is out of date)
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { themeCss, DEFAULT_THEME } from '../src/shared/themes.js';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const MARK = '/* Theme variables: the default theme.';
for (const [file, sel] of [['src/content/styles/injected.css', '.layer'], ['src/popup/popup.css', ':root'], ['src/options/options.css', ':root']]) {
  const p = join(root, file);
  let s = readFileSync(p, 'utf8');
  const block = `${MARK} The interface sets the chosen theme on top of these (src/shared/themes.js). */\n${sel} { ${themeCss(DEFAULT_THEME)} }\n`;
  if (s.startsWith(MARK)) s = s.slice(s.indexOf('}\n', s.indexOf('{')) + 2); // drop the old block (one rule on one line)
  writeFileSync(p, block + s);
  console.log('synced', file);
}
