// Your own authority server: answers the extension from the local index. Listens on this computer only.
//   npm run authority:start        → http://127.0.0.1:8787/authority?domain=example.com
import { createServer } from 'node:http';
import { join, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { openIndex } from './lib.mjs';

export const PORT = 8787;

export function createAuthorityServer(dir) {
  return createServer((req, res) => {
    const send = (status, body) => {
      const origin = req.headers.origin || '';
      res.writeHead(status, { 'content-type': 'application/json', 'cache-control': 'no-store', ...(origin.startsWith('chrome-extension://') ? { 'access-control-allow-origin': origin } : {}) });
      res.end(JSON.stringify(body));
    };
    // only requests addressed to this computer by name: another website cannot reach it through a DNS trick
    if (!/^(127\.0\.0\.1|localhost)(:\d+)?$/.test(req.headers.host || '')) return send(403, { error: 'Local requests only.' });
    const url = new URL(req.url, 'http://127.0.0.1');
    if (req.method !== 'GET' || url.pathname !== '/authority') return send(404, { error: 'Not found.' });
    const index = openIndex(dir); // read each time, so a new build is picked up without a restart
    if (!index) return send(503, { error: 'No index yet. Run: npm run authority:build' });
    const result = index.lookup(url.searchParams.get('domain'));
    return result ? send(200, result) : send(400, { error: 'Not a domain name.' });
  });
}

if (import.meta.url === pathToFileURL(process.argv[1] || '').href) {
  const dir = join(dirname(fileURLToPath(import.meta.url)), 'data');
  const server = createAuthorityServer(dir);
  server.on('error', (e) => { console.error(e.code === 'EADDRINUSE' ? `Port ${PORT} is already in use.` : e.message); process.exit(1); });
  server.listen(PORT, '127.0.0.1', () => {
    const index = openIndex(dir);
    console.log(`LinkLens Authority server: http://127.0.0.1:${PORT}`);
    console.log(index ? `Index: ${index.meta.indexed.toLocaleString()} domains (${index.meta.release})` : 'No index yet. Run: npm run authority:build');
  });
}
