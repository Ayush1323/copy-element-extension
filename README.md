# MindInventory Instant Copy

> **Select. Extract. Copy. Done.**

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
| **Link attribute preview** | In Element Picker, hovering any link (including nested elements, dynamic links and open Shadow DOM) shows its text, resolved `href`, `target`, every `rel` value, `title`, `download` and `aria-label` in a floating panel, with copy buttons for URL, rel and HTML. Missing attributes read *Not specified*. |
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

## Permissions

| Permission | Why |
|---|---|
| `activeTab` | Temporary access to the current tab only after you click the icon or use a shortcut. No host permissions are requested. |
| `scripting` | Inject the content script into that tab (all accessible frames). |
| `storage` | Settings and local copy history. |
| `clipboardWrite` | Copy when the browser has no fresh user gesture (e.g. `Alt+C`). |

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

- Chrome blocks extensions on `chrome://`, the Chrome Web Store and some other browser pages; the popup says so.
- Cross-origin iframes are only reachable when `activeTab` covers them; closed Shadow DOM content is invisible to any extension.
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
