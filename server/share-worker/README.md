# LinkLens share backend (deployed once, by the developer) — 100% free, no card

The screenshot editor's **Link** button uploads to this tiny Cloudflare Worker, which stores the image in **Workers KV**
(Cloudflare's free key-value store) and returns an unguessable public link. **Extension users configure nothing.** The Worker's
address is baked into the extension at build time.

```
Chrome extension ──POST /upload──▶ Worker (validates, rate-limits) ──▶ Workers KV
        ▲                                                                   │
        └────────── https://<worker>/i/<16 random chars>.png ◀──────────────┘
```

KV is reachable **only through the Worker**, so there are no storage keys or tokens in the extension package.

## One-time deployment (about 3 minutes, free plan, no payment method)

```bash
cd server/share-worker
npx wrangler logout && npx wrangler login      # approve in the browser; `npx wrangler whoami` should list your account
npx wrangler kv namespace create SHOTS         # prints:  id = "abcd1234…"
```

Open `wrangler.toml` and replace `PASTE_THE_ID_FROM_wrangler_kv_namespace_create` with that id, then:

```bash
npx wrangler deploy                            # prints https://linklens-share.<your-subdomain>.workers.dev
```

(If wrangler complains about the `[[unsafe.bindings]]` rate-limit block, delete that block and deploy again; everything else works without it.)

The production address is the default in `scripts/build.mjs` (currently `https://linklens-share.ayush-patel-6d2.workers.dev`). If you deploy under a different
address, change it there, or build with `LINKLENS_SHARE_API=https://… npm run build`.

## How a link is made (like Lightshot, but unguessable)

Lightshot uploads the image to its own servers, stores it, and answers with a short link. Same idea here: the Worker stores the file under a
random key and answers `https://<worker>/i/<key>.png`. The key has 16 random characters (96 bits), so strangers cannot guess other people's links.

## Behaviour

| | |
|---|---|
| Expiry | **30 days by default**, enforced by the server: KV deletes the file by itself when time is up, and an expired link answers 404 at once. Change `EXPIRY_DAYS` in `wrangler.toml` (0 = never) and run `npx wrangler deploy`. |
| Validation | Only PNG and JPEG, checked by the file's real signature (not just the header). 20 MB limit (`MAX_BYTES`, KV's own limit is 25 MiB). |
| Abuse | 20 uploads per minute per address (`RATE_LIMITER`). |
| Serving | `nosniff`, a locked-down CSP, `noindex`. Uploaded files can never run as a page or be indexed. |
| CORS | Open (`*`); the extension uploads from its background script with no credentials. |
| Logging | Nothing about image contents is logged. |

### Deleting a screenshot early

`npx wrangler kv key delete --binding SHOTS --remote <id>.png` (the id is the part of the link before `.png`).

### Free-plan limits (honest)

* **1,000 uploads per day** across all users, **100,000 views per day**, 1 GB total storage. Past that, uploads fail with a normal "try again" error until the next day. Because files expire after 30 days, 1 GB holds roughly 30,000+ typical screenshots.
* The upload endpoint is public (the extension has no secret to prove who it is). Rate limit, size limit and signature check make abuse harder, but cannot stop a determined person using up the free daily quota. If that ever matters, move to the paid Workers plan (about $5/month) or add Cloudflare Turnstile.

## Tests

`npm test` runs `tests/unit/share.test.mjs` against `worker.js` with a fake KV and rate limiter.
