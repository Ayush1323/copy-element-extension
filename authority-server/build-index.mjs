// Builds the lookup index from Common Crawl's domain ranks file.
//   npm run authority:build                      → the top 5 million domains (downloads only as far as needed)
//   npm run authority:build -- --limit all       → every domain (2.5 GB download, several GB of disk)
//   npm run authority:build -- --file ranks.txt.gz
// Every build goes into a new folder; the server switches to it only when it is complete. Old folders are left in place.
import { createReadStream, mkdirSync, appendFileSync, writeFileSync, renameSync } from 'node:fs';
import { createGunzip } from 'node:zlib';
import { Readable } from 'node:stream';
import { createInterface } from 'node:readline';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { RELEASE, RANKS_URL, TOTAL_DOMAINS, shardOf, shardName, parseLine } from './lib.mjs';

const FLUSH_BYTES = 96 * 1024 * 1024;

export async function buildIndex({ input, dir, limit = Infinity, total = TOTAL_DOMAINS, release = RELEASE, log = () => {} }) {
  const folder = `${release}-${Date.now()}`;
  const out = join(dir, folder);
  mkdirSync(out, { recursive: true });
  const buffers = new Map();
  let bytes = 0, indexed = 0, complete = true;
  const flush = () => { for (const [n, lines] of buffers) appendFileSync(join(out, shardName(n)), lines); buffers.clear(); bytes = 0; };

  const gunzip = createGunzip();
  input.on('error', (e) => gunzip.destroy(e));
  const lines = createInterface({ input: input.pipe(gunzip), crlfDelay: Infinity });
  try {
    for await (const line of lines) {
      const row = parseLine(line);
      if (!row) continue;
      if (indexed >= limit) { complete = false; break; } // the file is sorted best first, so these are the top domains
      const n = shardOf(row.domain), text = `${row.domain}\t${row.harmonicRank}\t${row.pageRank}\n`;
      buffers.set(n, (buffers.get(n) || '') + text);
      bytes += text.length;
      indexed++;
      if (bytes > FLUSH_BYTES) flush();
      if (indexed % 1_000_000 === 0) log(`${(indexed / 1e6).toFixed(0)} million domains…`);
    }
  } finally { input.destroy(); }
  if (!indexed) throw new Error('No domains were read: is this a Common Crawl domain ranks file?');
  flush();
  const meta = { folder, release, total, indexed, complete, builtAt: new Date().toISOString() };
  writeFileSync(join(dir, 'current.json.tmp'), JSON.stringify(meta, null, 2));
  renameSync(join(dir, 'current.json.tmp'), join(dir, 'current.json'));
  return meta;
}

async function main() {
  const args = process.argv.slice(2);
  const option = (name) => { const i = args.indexOf(`--${name}`); return i >= 0 ? args[i + 1] : undefined; };
  const raw = option('limit') || '5000000';
  const limit = raw === 'all' ? Infinity : Number(raw);
  if (!(limit > 0)) throw new Error('--limit must be a number or "all"');
  const file = option('file');
  let input;
  if (file) input = createReadStream(resolve(file));
  else {
    const res = await fetch(RANKS_URL);
    if (!res.ok) throw new Error(`Download failed: HTTP ${res.status} from ${RANKS_URL}`);
    input = Readable.fromWeb(res.body);
  }
  const dir = join(dirname(fileURLToPath(import.meta.url)), 'data');
  console.log(`Building from ${file || RANKS_URL}`);
  const meta = await buildIndex({ input, dir, limit, log: console.log });
  console.log(`Done: ${meta.indexed.toLocaleString()} domains indexed. Start the server with: npm run authority:start`);
}

if (import.meta.url === pathToFileURL(process.argv[1] || '').href) {
  main().catch((e) => { console.error(`Build failed: ${e.message}`); process.exit(1); });
}
