// LinkLens share server: a tiny Cloudflare Worker that stores screenshots in Workers KV (free, no card needed) and serves them under unguessable links.
// Deployed ONCE by the developer; extension users never configure anything. No secret ever lives in the extension.
//
//   POST /upload      body = the image (image/png or image/jpeg), verified by its file signature
//                     -> 200 { url, expiresAt }     429 when an address uploads too fast     413 too large     415 not an image
//   GET  /i/<id>.png  the image (404 when unknown, expired or deleted; KV deletes expired files by itself)
//
// Bindings:  SHOTS (Workers KV namespace, required)    RATE_LIMITER (Workers rate-limit binding, recommended)
// Variables: EXPIRY_DAYS (default 30, 0 = never)   MAX_BYTES (default 25 MB)

const TYPES = { 'image/png': 'png', 'image/jpeg': 'jpg' };
const ID_RE = /^\/i\/([A-Za-z0-9_-]{16})\.(png|jpg)$/;
const DEFAULT_MAX = 20 * 1024 * 1024; // Workers KV values can be at most 25 MiB
const DEFAULT_EXPIRY_DAYS = 30; // change here, or set the EXPIRY_DAYS variable in wrangler.toml


const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Access-Control-Max-Age': '86400',
};

const json = (body, status = 200, extra = {}) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', ...CORS, ...extra } });

/** 16 URL-safe characters = 96 bits of randomness: links cannot be guessed. */
export function newId() {
  const b = crypto.getRandomValues(new Uint8Array(16));
  let s = '';
  for (const x of b) s += String.fromCharCode(x);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '').slice(0, 16);
}

/** The bytes must really be a PNG or a JPEG, whatever the Content-Type header claims. */
export function sniffType(b) {
  if (b.length > 8 && b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47 && b[4] === 0x0d && b[5] === 0x0a && b[6] === 0x1a && b[7] === 0x0a) return 'image/png';
  if (b.length > 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return 'image/jpeg';
  return '';
}

export default {
  async fetch(req, env) {
    const url = new URL(req.url);
    if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS });

    if (url.pathname === '/upload') {
      if (req.method !== 'POST') return json({ error: 'Use POST.' }, 405);
      if (env.RATE_LIMITER) {
        const who = req.headers.get('CF-Connecting-IP') || 'unknown';
        const { success } = await env.RATE_LIMITER.limit({ key: who });
        if (!success) return json({ error: 'Too many uploads. Try again in a minute.' }, 429, { 'Retry-After': '60' });
      }
      const type = (req.headers.get('Content-Type') || '').split(';')[0].trim().toLowerCase();
      if (!TYPES[type]) return json({ error: 'Only PNG and JPEG images are accepted.' }, 415);
      const max = Number(env.MAX_BYTES) || DEFAULT_MAX;
      if (Number(req.headers.get('Content-Length') || 0) > max) return json({ error: 'Image too large.' }, 413);
      const body = await req.arrayBuffer();
      if (body.byteLength === 0) return json({ error: 'Empty upload.' }, 400);
      if (body.byteLength > max) return json({ error: 'Image too large.' }, 413);
      if (sniffType(new Uint8Array(body, 0, Math.min(16, body.byteLength))) !== type) return json({ error: 'The file is not a valid PNG or JPEG image.' }, 415);
      const ext = TYPES[type];
      const days = env.EXPIRY_DAYS === undefined || env.EXPIRY_DAYS === '' ? DEFAULT_EXPIRY_DAYS : Math.max(0, Number(env.EXPIRY_DAYS) || 0);
      const expiresAt = days ? Date.now() + days * 86400000 : 0;
      const id = newId();
      // KV removes the entry on its own once expirationTtl has passed (minimum 60 s)
      await env.SHOTS.put(`${id}.${ext}`, body, { metadata: { type, expiresAt }, ...(days ? { expirationTtl: Math.max(60, Math.round(days * 86400)) } : {}) });
      return json({ url: `${url.origin}/i/${id}.${ext}`, expiresAt: expiresAt || null });
    }

    const m = ID_RE.exec(url.pathname);
    if (m && (req.method === 'GET' || req.method === 'HEAD')) {
      const key = `${m[1]}.${m[2]}`;
      const { value, metadata } = await env.SHOTS.getWithMetadata(key, 'arrayBuffer');
      if (!value) return new Response('Not found', { status: 404, headers: CORS });
      const exp = Number(metadata && metadata.expiresAt) || 0;
      if (exp && exp < Date.now()) {
        await env.SHOTS.delete(key);
        return new Response('This link has expired.', { status: 404, headers: CORS });
      }
      return new Response(req.method === 'HEAD' ? null : value, {
        headers: {
          'Content-Type': (metadata && metadata.type) || 'image/png',
          'Cache-Control': 'public, max-age=300',
          'X-Content-Type-Options': 'nosniff',
          'Content-Security-Policy': "default-src 'none'; sandbox",
          'X-Robots-Tag': 'noindex, nofollow',
          ...CORS,
        },
      });
    }

    return new Response('LinkLens share server', { status: 404, headers: { 'X-Robots-Tag': 'noindex' } });
  },
};
