# Test checklist

Legend: ✅ automated (passes in `npm test` / `npm run test:e2e`) · 🖐 manual (needs a human, a real Chrome UI or another app)

## A — MindInventory clickable portfolio card
Page: https://www.mindinventory.com/cloud-managed-services/ → "Asset Allocation Robo-Advisory App"
(✅ = covered by `LIVE=1 npm run test:e2e`, which drives real Chrome with the built extension)

- ✅ Activate Element Picker (popup path → service worker → injection)
- ✅ Hover heading → label `H3 HEADING` (the live site uses `<h3><a class="stretched-link">`)
- ✅ Copy heading (click) → exact heading text
- ✅ Hover + copy paragraph (label `PARAGRAPH`)
- ✅ Hover + copy individual badge/tag (`APEX Implementation`)
- ✅ Hover empty card space (the photo) → label `CARD`
- ✅ Copy complete card → heading, description, tags, `Outcomes:` and every statistic, no duplicates
- ✅ No navigation during any extraction click
- ✅ Esc exits picker; the stretched-link card navigates again
- 🖐 Same flow using the real toolbar button (popup click) instead of the test harness

## B — Normal website (fixtures: `tests/fixtures/*.html`)
- ✅ H1 / H2 / paragraph / list / ordered list / nested list / button / CTA link / nav (unit: `extraction.test.mjs`)
- ✅ Inline `<strong>`, `<em>`, links preserved in Rich Text
- ✅ Hidden, `sr-only`, script and style content ignored
- 🖐 Footer on a few real sites (WordPress, Next.js, Angular, Vue)

## C — Section extraction
- ✅ Full section, multiple headings, nested cards, lists, paragraphs, CTA — no duplicated text
- ✅ Section boundary does not leak into the next section (FAQ / footer detection)
- 🖐 Hero / pricing / testimonial / FAQ accordions on real sites

## D — Clipboard
- ✅ Plain text (e2e reads `navigator.clipboard.readText()`)
- ✅ Rich HTML + plain text flavours written together (e2e reads `text/html`)
- ✅ Sanitizer: scripts, handlers, styles, `javascript:` / `data:` URLs removed
- 🖐 Paste into **Figma** (text layer) — expect plain text; Figma ignores most HTML
- 🖐 Paste into **Google Docs** with Rich Text selected — expect headings, bullets, links
- 🖐 Paste into a plain text editor

## E — UI
- ✅ Popup renders 4 action cards, status, activity list; no console errors
- ✅ Format selector persists; recent item re-copy + delete
- ✅ Options page saves settings and resets
- ✅ Copy history stored; stays empty when disabled
- ✅ Toolbar handle + menu stay inside the viewport (top-edge element)
- ✅ Preview panel: counts, per-part copy, Copy All → Copy Again, Esc closes panel first
- ✅ Selected Text mode shows the copy button and keeps the selection
- ✅ Typing in inputs is not hijacked while the picker is active
- ✅ Restricted URLs (chrome://, Web Store …) detected before injection (unit: `helpers.test.mjs`); 🖐 confirm the popup message on a real chrome:// tab
- 🖐 Toast notifications visually; dark/light pages; high-DPI
- 🖐 Keyboard shortcuts (Chrome commands cannot be triggered through DevTools protocol):
  `Alt+E`, `Alt+S`, `Alt+C`, then `Esc`. Change them at `chrome://extensions/shortcuts`.
- 🖐 Same-origin iframe and open Shadow DOM pages
- 🖐 Install via *Load unpacked* → `dist/` on Windows and macOS
