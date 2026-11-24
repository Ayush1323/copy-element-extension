# LinkLens

> **Hover. Discover. Copy.**

LinkLens is a smart browser extension that instantly reveals hyperlink destinations, HTML link attributes, and available link information when hovering over links on websites.

A Manifest V3 Chrome extension for designers, developers and content teams. Hover any website content,
see it highlighted, and copy a heading, paragraph, tag, whole **card** or whole **section** straight into
Figma, Google Docs or any text editor — without opening DevTools.

Everything runs locally in the browser: no backend, no analytics, no external APIs.

## Features

| | |
|---|---|
| **Element Picker** | Hover → highlight → click to copy. Exact text-node detection (`caretPositionFromPoint` / `caretRangeFromPoint` / `elementsFromPoint` + `TreeWalker` fallbacks), never "just the parent link". |
| **Card Extractor** | Finds the complete card from DOM structure (repeated siblings, boxes, semantic tags, text density — no site-specific selectors) and extracts heading, description, tags, buttons, statistics and lists in reading order. |
| **Section Extractor** | Highlights a whole section and copies it with heading hierarchy, paragraphs, lists and CTAs, de-duplicated. |
| **Selected Text** | A small *Copy* button appears next to any text selection. |
| **Force Copy** | Clickable / stretched-link cards never navigate while a picker is active; page click handlers are suppressed; normal behaviour is restored on exit. |
| **Link attribute preview** | In Element Picker, hovering any link (including nested elements, dynamic links and open Shadow DOM) shows its text, resolved `href`, `target`, every `rel` value, `title`, `download` and `aria-label` in a floating panel, with copy buttons for URL, rel and HTML. Missing attributes read *Not specified*. After the pointer rests on a link for a moment, a small live preview of the destination page appears in the panel (toggle in Settings → *Link preview*); click it or *Open in new tab* to open the link. Sites that forbid embedding (X-Frame-Options) show an *Enable full previews* hint; turning on *Settings → Preview sites that block embedding* (optional all-sites permission, asked at that moment) renders them anyway by relaxing frame-blocking headers only for LinkLens's own preview frame. Links that look like actions (log out, delete…) are never loaded. |
| **Inspect Images & Text** | Hover any `<img>` or CSS background image: it is outlined and a DevTools-style tooltip shows rendered size & aspect ratio, intrinsic size & ratio, file size and current source. Hover any **text** and a panel shows its font family (and fallback stack), size (px and rem), weight (number and name), style, line height, letter spacing, **text colour** and the **background colour behind it**, WCAG contrast, alignment, decoration and transform, plus a live sample in the same font. Every colour can be copied as **HEX, RGB or HSL** (buttons, or click the swatch); the font name and a ready-to-paste CSS block copy too. `Alt+C` copies the hovered text colour (or the image URL). Values come straight from the browser's computed style; over an image or gradient the background is reported as such instead of inventing a colour. The page stays fully clickable. |
| **Screenshot** | Capture → select → edit → copy / download, **all on the page you are looking at** (no new tab, window or editor page). Select an area (move / resize it), or take the visible screen or a stitched full page; annotate with pencil, arrow, line, rectangle, ellipse, highlighter, text, numbered steps, blur / pixelate and eraser; select, move, resize and delete annotations; undo / redo; copy to the clipboard, download a PNG or save as PNG / JPEG. Shortcut `Alt+Shift+S`. |
| **Text Utils** | A small floating panel you can drag anywhere on the page: **Upper Case**, **Lower Case**, **Capitalize First Letter** (every sentence), **Capitalize Each Word**, **Remove Extra Spaces**, **Replace Space With "-"** and **"_"**, and **Find & Replace** (plain text, match case, or regex with `$1` groups). Select part of the text to change only that part; undo / redo / clear, live word and character count, one-click **Copy**, Alt-key shortcuts (the shortcut list is in the panel). Opens with the text you had selected on the page. Nothing leaves the page and the text is never stored, only where you left the panel. |
| **Dimensions** | Hover any element to see its box model drawn like DevTools: **margin** (orange), **border**, **padding** (green) and content (blue), each with its number, the size label and an info card (size, margin, border, padding, gap, display, position). **Flex and grid gaps** are drawn between the items with their values (row and column separately). **Click to pin** an element, then hover another one to see the **distance** between them (gap, or the distance to every side when one is inside the other). `Shift` shows the distance to the parent, `Alt+↑ / ↓` measures the parent / child, `Alt+C` copies the measurements as CSS. The page itself is paused while measuring (no clicks, no navigation); `Esc` leaves. |
| **SEO Analyzer** | A draggable panel with a 0–100 **score**, a "fix first" list and eight tabs. **Overview**: title and description with length gauges, URL, canonical, meta robots, language, viewport, hreflang, favicon and live **Core Web Vitals** (LCP, INP, CLS, FCP, TTFB). **Headings**: the full H1–H6 outline with problems (no or several H1, skipped levels, empty headings), copy as Markdown. **Status**: HTTP status, indexability verdict with reasons, timing and the real response headers (X-Robots-Tag, security headers). **Links**: internal / external / nofollow / sponsored, weak anchor text, an optional **status check** of every link, copy as CSV. **Images**: alt text, oversized images, missing width / height, file sizes, thumbnails. **Schema**: JSON-LD (with missing-property warnings), microdata and RDFa. **Social**: Facebook and X previews, the real og:image size and every Open Graph / Twitter tag. **Resources**: requests, transfer size, third parties and render-blocking files. The footer shows the H1–H6, link and image counts and opens **robots.txt** (is this page allowed for `*` and Googlebot, highlighted rules) and the **sitemap** (is this page listed). Click any row to scroll to and outline the element on the page. Everything is read locally; the only requests are the ones you start (headers, robots.txt, sitemap, link check). Checking links on other sites needs the optional all-sites permission. |
| **Floating toolbar** | Compact handle with the element type; hover it for *Copy Text · Copy Element · Copy Card · Copy Section · Preview*. Always clamped inside the viewport. |
| **Preview panel** | Structured preview with character/block counts, per-part copy, *Copy All / Plain / Rich / Copy Again*. |
| **Clipboard** | Plain text or sanitized Rich HTML (`text/html` + `text/plain` in one `ClipboardItem`), with `writeText` and `execCommand` fallbacks. |
| **History** | Last 25 copies (content, type, domain, time) in `chrome.storage.local`; re-copy, delete, clear, or disable. |
| **Settings** | Default format, history, toolbar, highlight colour, labels, toasts, instant vs preview, heading style, include buttons, reset. |

## Install (no build needed for end users)

```bash
npm install
npm run build        # → dist/
```

1. Open `chrome://extensions`
2. Enable **Developer mode**
3. **Load unpacked** → choose the `dist/` folder
4. Pin the extension and click it on any website.

## Usage

1. Open any website and click the extension icon (or press `Alt+E`).
2. Choose **Element Picker**, **Card Extractor**, **Section Extractor** or **Selected Text**.
   The popup closes and a dark pill at the top of the page shows the active mode; switch modes there.
3. Hover — the target is outlined and labelled (`H2 HEADING`, `PARAGRAPH`, `CARD`, …).
4. **Click** to copy (the page does not navigate). Or hover the blue handle for the toolbar:
   - **Copy Text** – exact text, always plain
   - **Copy Element** – structured text / HTML according to your default format
   - **Copy Card** / **Copy Section** – nearest card / section around the hovered element
   - **Eye** – preview first
5. `Esc` exits (first `Esc` closes an open preview).

Hovering *empty card space* (padding, photo, stretched-link overlay) selects the complete card.
`Alt+↑` / `Alt+↓` move the selection to the parent / back to the child.

If the toolbar covers the next thing you want to hover, just move off it — it only expands while hovered, and it
stays on the previous element for ~0.3 s so the pointer can reach it.

### Keyboard shortcuts

| Shortcut | Action |
|---|---|
| `Alt+E` | Activate / toggle Element Picker |
| `Alt+S` | Activate / toggle Section Extractor |
| `Alt+C` | Copy the hovered element |
| `Alt+↑ / ↓` | Select parent / child |
| `Esc` | Exit current mode |

Change them at **`chrome://extensions/shortcuts`** (extension commands: *Activate Element Picker*,
*Copy hovered element*, *Activate Section Extractor*). On Windows `Alt+E` can collide with Chrome's own menu
accelerator — rebind it there if it does not fire.

## Architecture

```
manifest.json              MV3 manifest (copied into dist/)
src/
  background/service-worker.js   injection (allFrames), commands, badge, tab ↔ frame mode sync
  popup/                         popup.html/css/js + components/{header,action-card,activity-list}.js
  options/                       settings page
  content/
    index.js                     bootstrap + message routing (injected on demand)
    core/
      picker-controller.js       state machine: modes, hover, interception, actions, keyboard
      element-detector.js        pointer → element (text node first, controls, empty space → card)
      text-node-detector.js      caret APIs + TreeWalker/rect fallback
      text-extractor.js          DOM → ordered blocks (heading/text/list/group/label/stat/button)
      card-extractor.js          structural card detection + extraction
      section-extractor.js       section detection + extraction
      copy-service.js            payloads, clipboard commit, history
      dom-utils.js               visibility, block/flow analysis, shadow-DOM-aware helpers
    modes/                       element / card / section / text mode definitions
    ui/                          closed Shadow DOM host, highlight, toolbar, preview, toast, indicator, selection button
    clipboard/                   clipboard-manager, text-formatter, html-formatter, html-sanitizer
    styles/injected.css          all on-page styling (lives inside the shadow root)
  shared/                        constants, message types, storage, helpers, icons
  utils/                         logger, error-handler
scripts/                         build.mjs (esbuild), make-icons.mjs
tests/                           unit (node:test + jsdom), e2e (puppeteer + real Chrome), fixtures, checklist
```

**Build:** esbuild bundles each entry to a self-contained IIFE (content scripts cannot use ES-module imports);
`.css` is inlined as text into the content bundle for the shadow root. Popup/options pages and the manifest are copied.

**Force Copy:** while a picker is active, a capture-phase handler on `window` swallows
`pointerdown/up, mousedown/up, dblclick, auxclick, touchstart/end` with `stopImmediatePropagation()` (without
`preventDefault`, so text selection still works) and handles `click` with `preventDefault()` +
`stopImmediatePropagation()` before running the extraction. Events whose target/path is our shadow host, and editable
controls (inputs, textareas, contenteditable), are left alone; wheel/keyboard are never blocked. All listeners,
the MutationObserver, ResizeObserver, rAF loop and the temporary cursor `<style>` are removed on exit.

**Performance:** hover detection is rAF-throttled; one `getBoundingClientRect` per frame keeps the outline aligned
while hovering; style/layout lookups are memoised per detection pass; overlays are created once and reused.

## Screenshot

Open it from the popup (**Screenshot**) or press `Alt+Shift+S` (rebind at `chrome://extensions/shortcuts`).

1. **Capture** – the tab is captured losslessly (`chrome.tabs.captureVisibleTab`) and shown, dimmed, exactly where the page is.
2. **Select** – drag an area; resize with the 8 handles, move by dragging inside; the size is shown live. Or use the bar at the top:
   *Selected area* (or press `Enter` / double-click), *Visible screen*, *Full page*, *Cancel* (`Esc`).
3. **Edit** – the cropped screenshot becomes an editor right where you selected, with a floating tool column, an options bar
   (colour, thickness, text size / background, blur mode) and an action bar. All three can be dragged by their grip.
4. **Finish** – *Copy* (`Ctrl/⌘+C`), *Download* (PNG with a date/time name, `Ctrl/⌘+D`), *Save* (choose the name and PNG / JPEG,
   optionally the folder; `Ctrl/⌘+S`) or *Close* (`Esc`). The page underneath is left exactly as it was.

| Tool | Key | | Tool | Key |
|---|---|---|---|---|
| Select / move / resize | `V` | | Text | `T` |
| Pencil | `P` | | Numbered step | `N` |
| Arrow · Line | `A` · `L` | | Blur / pixelate | `B` |
| Rectangle · Ellipse | `R` · `O` | | Eraser | `X` |
| Highlighter | `H` | | Undo · Redo | `Ctrl/⌘+Z` · `Ctrl/⌘+Y` |

`Shift` while drawing gives straight / 45° lines and squares / circles; `Delete` removes the selected annotation; double-click a text
annotation to edit it. Annotations are stored in image coordinates, so they stay put when the full-page view is zoomed, and the
original screenshot is never modified (blur / pixelate sample the untouched screenshot).

**Full page** scrolls the page top to bottom (about 2 captures per second — a Chrome limit), hides fixed / sticky elements after the
first screen so they are not repeated, stitches the result and restores the scroll position and every inline style it touched.
It is only offered when the page itself scrolls; pages that scroll inside an inner container are captured as the visible screen and
labelled as such. Very tall pages (> 16 000 px at device resolution) are saved at reduced resolution and you are told so.

## Permissions

| Permission | Why |
|---|---|
| `activeTab` | Temporary access to the current tab only after you click the icon or use a shortcut — also what allows the screenshot capture. No host permissions are requested. |
| `scripting` | Inject the content script into that tab (all accessible frames). |
| `storage` | Settings and local copy history. |
| `clipboardWrite` | Copy when the browser has no fresh user gesture (e.g. `Alt+C`), and copy screenshots as images. |

## Privacy

All processing is local. No servers, analytics, tracking scripts or paid/AI APIs. History lives in
`chrome.storage.local` and can be disabled or cleared in Settings. Copied HTML is passed through an allow-list
sanitizer (no scripts, handlers, inline styles or `javascript:`/`data:` links).

## Testing

```bash
npm test                       # unit tests (jsdom): extraction, cards, sections, sanitizer, toolbar placement
npm run build && npm run test:e2e        # real Chrome + the built extension, local fixtures
LIVE=1 npm run test:e2e                  # + https://www.mindinventory.com/cloud-managed-services/
```

The e2e runner copies `dist/` to `tests/e2e/.tmp`, adds localhost host permissions (so it can inject without a
toolbar click) and — for test only — switches the closed shadow root to open so puppeteer can query the UI.
It needs Chrome (`CHROME_PATH` to override `/usr/bin/google-chrome`) and Node ≥ 18. Manual items are listed in
[tests/test-checklist.md](tests/test-checklist.md).

## Limitations

- Chrome blocks extensions (and screenshots) on `chrome://`, the Chrome Web Store and some other browser pages; the popup says so.
- Screenshots capture what the tab is showing: cross-origin iframes and video are included as rendered, but content that is not painted (e.g. `<select>` popups, native context menus) is not.
- Full-page capture cannot see inside inner scroll containers; `position: sticky/fixed` elements appear only in the first screen.
- Cross-origin iframes are only reachable when `activeTab` covers them; closed Shadow DOM content is invisible to any extension.
- The text inspector shows the font *stack* the page asks for (first name = the declared font); browsers do not expose which of those fonts was actually used to paint. Colours are the computed CSS colours: element `opacity`, blend modes and filters are not applied, and text over an image or gradient has no single background colour.
- Sites that handle clicks in a `window` capture listener registered *before* the picker started can still see that click.
  Navigation itself (`preventDefault`) is still blocked.
- Pages that navigate on `pointerdown` through a listener attached to `window` in capture phase before injection are out of reach.
- Figma pastes plain text; most apps drop some HTML styling from Rich Text — headings/lists/links survive best in Google Docs.
- Labels like "Technologies:" appear only if the page has such a text element; the extractor never invents them.
- Rich Text requires `ClipboardItem`; otherwise it falls back to plain text and tells you.
- Default shortcuts may be taken by the OS/Chrome; rebind at `chrome://extensions/shortcuts`.

## Troubleshooting

- **Nothing happens on a page** – it may be a restricted page; open a normal website. After reloading the extension,
  reload the page too (old content scripts are orphaned).
- **Copy button says clipboard blocked** – click the page once to give it focus, then retry.
- **Shortcut doesn't fire** – check `chrome://extensions/shortcuts` for conflicts.
- **Wrong element selected** – use `Alt+↑ / ↓`, or switch to Card / Section mode in the top pill.
- **Toolbar in the way** – it collapses to a small handle; move the pointer off it to keep hovering.

## License

MIT
