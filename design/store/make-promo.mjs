// Renders the Chrome Web Store promo tiles: node design/store/make-promo.mjs
// Output: 24-bit PNG (no alpha). Needs Chrome installed (or set CHROME_PATH).
import { readFileSync, writeFileSync, mkdtempSync, rmSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const here = (p) => fileURLToPath(new URL(p, import.meta.url));
const glyph = `data:image/png;base64,${readFileSync(here('../logo/glyph-1024.png')).toString('base64')}`;
const chrome = process.env.CHROME_PATH || 'C:/Program Files/Google/Chrome/Application/chrome.exe';

const base = (w, h, css, body) => `<!doctype html><meta charset="utf-8"><style>
*{margin:0;padding:0;box-sizing:border-box}
body{width:${w}px;height:${h}px;overflow:hidden;position:relative;color:#fff;
  font-family:"Segoe UI",system-ui,sans-serif;-webkit-font-smoothing:antialiased;
  background:radial-gradient(circle at 85% 10%,#7C73FF 0,transparent 55%),linear-gradient(135deg,#4F46E5 0%,#3730A3 60%,#27217A 100%)}
.ring{position:absolute;border-radius:50%;border:1px solid rgba(255,255,255,.12)}
.tile{display:grid;place-items:center;background:#fff;flex:none}
.tile i{display:block;background:#4F46E5;-webkit-mask:url(${glyph}) center/contain no-repeat}
em{font-style:normal;color:#FBBF24}
${css}</style><body>${body}`;

const small = base(440, 280, `
.wrap{position:relative;height:100%;display:flex;flex-direction:column;align-items:center;justify-content:center}
.brand{display:flex;align-items:center;gap:16px}
.tile{width:76px;height:76px;border-radius:19px;box-shadow:0 12px 28px rgba(15,10,70,.35)}
.tile i{width:58px;height:58px}
h1{font-size:54px;font-weight:700;letter-spacing:-1.5px}
p{margin-top:24px;font-size:26px;font-weight:600}
small{margin-top:8px;font-size:16px;color:#D5D3FF}
`, `
<div class="ring" style="width:420px;height:420px;left:-190px;top:-230px"></div>
<div class="ring" style="width:360px;height:360px;right:-170px;bottom:-220px"></div>
<div class="wrap">
  <div class="brand"><div class="tile"><i></i></div><h1>LinkLens</h1></div>
  <p>Hover. Discover. <em>Copy.</em></p>
  <small>Inspect links, text and page elements</small>
</div>`);

const row = (k, v) => `<div class="row"><b>${k}</b><span>${v}</span><u>Copy</u></div>`;
const marquee = base(1400, 560, `
.left{position:absolute;left:90px;top:0;height:100%;display:flex;flex-direction:column;justify-content:center}
.brand{display:flex;align-items:center;gap:20px}
.tile{width:88px;height:88px;border-radius:22px;box-shadow:0 14px 32px rgba(15,10,70,.35)}
.tile i{width:68px;height:68px}
.brand h1{font-size:58px;font-weight:700;letter-spacing:-1.5px}
h2{margin-top:34px;font-size:64px;line-height:1.12;font-weight:700;letter-spacing:-1.5px}
p{margin-top:18px;font-size:24px;line-height:1.5;color:#D5D3FF}
.chips{margin-top:30px;display:flex;gap:10px}
.chips span{font-size:17px;font-weight:600;padding:9px 18px;border-radius:99px;background:rgba(255,255,255,.12);border:1px solid rgba(255,255,255,.22)}
.page{position:absolute;left:785px;top:62px;width:560px;height:436px;border-radius:18px;background:#fff;color:#1E1B3A;box-shadow:0 30px 70px rgba(10,6,60,.45);overflow:hidden}
.bar{height:44px;background:#F1F1F8;display:flex;align-items:center;gap:8px;padding:0 18px}
.bar i{width:11px;height:11px;border-radius:50%;background:#C9C8DC}
.bar div{margin-left:14px;flex:1;height:24px;border-radius:12px;background:#fff;font-size:13px;color:#77759A;line-height:24px;padding:0 14px}
.content{padding:28px 34px}
h3{font-size:26px}
.line{height:11px;border-radius:6px;background:#E6E5F0;margin-top:14px}
.link{display:inline-block;margin-top:16px;font-size:18px;font-weight:600;color:#4F46E5;text-decoration:underline;padding:5px 9px;border:2px solid #4F46E5;border-radius:7px;background:#EEEDFD}
.panel{position:absolute;left:34px;right:34px;top:226px;border-radius:14px;background:#fff;border:1px solid #DEDCF0;box-shadow:0 18px 44px rgba(30,20,100,.22);padding:8px 20px}
.row{display:flex;align-items:center;gap:14px;height:46px;border-bottom:1px solid #EEEDF6;font-size:16px}
.row:last-child{border:0}
.row b{width:62px;font-size:13px;color:#77759A;font-weight:600}
.row span{flex:1;font-family:Consolas,monospace}
.row u{text-decoration:none;font-size:13px;font-weight:600;color:#4F46E5;background:#EEEDFD;border-radius:7px;padding:4px 12px}
.cursor{position:absolute;z-index:1;left:200px;top:192px;filter:drop-shadow(0 3px 4px rgba(0,0,0,.3))}
`, `
<div class="ring" style="width:760px;height:760px;left:-420px;top:-430px"></div>
<div class="ring" style="width:900px;height:900px;left:620px;top:-170px"></div>
<div class="left">
  <div class="brand"><div class="tile"><i></i></div><h1>LinkLens</h1></div>
  <h2>Hover. Discover. <em>Copy.</em></h2>
  <p>See where every link goes, then copy what you need.<br>No DevTools required.</p>
  <div class="chips"><span>Link preview</span><span>Element copy</span><span>Screenshot</span><span>SEO check</span></div>
</div>
<div class="page">
  <div class="bar"><i></i><i></i><i></i><div>example.com</div></div>
  <div class="content">
    <h3>Design resources</h3>
    <div class="line" style="width:92%"></div><div class="line" style="width:74%"></div>
    <div class="link">Read the style guide</div>
  </div>
  <svg class="cursor" width="34" height="34" viewBox="0 0 24 24"><path d="M4 2l16 9-7 2-3 7z" fill="#1E1B3A" stroke="#fff" stroke-width="1.6" stroke-linejoin="round"/></svg>
  <div class="panel">
    ${row('href', 'https://example.com/style-guide')}
    ${row('target', '_blank')}
    ${row('rel', 'noopener noreferrer')}
    ${row('title', 'Style guide')}
  </div>
</div>`);

const tmp = mkdtempSync(join(tmpdir(), 'promo-'));
try {
  for (const [name, w, h, html] of [['promo-small-440x280', 440, 280, small], ['promo-marquee-1400x560', 1400, 560, marquee]]) {
    const src = join(tmp, `${name}.html`);
    const out = here(`./${name}.png`);
    writeFileSync(src, html);
    execFileSync(chrome, ['--headless=new', '--hide-scrollbars', '--force-device-scale-factor=1',
      `--user-data-dir=${join(tmp, 'profile')}`, `--window-size=${w},${h}`, `--screenshot=${out}`, pathToFileURL(src).href], { stdio: 'ignore' });
    const png = readFileSync(out);
    // IHDR: width @16, height @20, bit depth @24, colour type @25 (2 = RGB, no alpha)
    console.log(name, `${png.readUInt32BE(16)}x${png.readUInt32BE(20)}`, `depth ${png[24]}`, `colorType ${png[25]}`);
  }
} finally {
  rmSync(tmp, { recursive: true, force: true, maxRetries: 5 });
}
