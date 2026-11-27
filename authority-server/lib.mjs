// LinkLens Authority: our own domain authority score, calculated from Common Crawl's web graph (which domains link to
// which, across the whole web). No third-party score is used. Shared by build-index.mjs and server.mjs.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

export const RELEASE = 'cc-main-2026-sep-oct-nov';
export const RANKS_URL = `https://data.commoncrawl.org/projects/hyperlinkgraph/${RELEASE}/domain/${RELEASE}-domain-ranks.txt.gz`;
export const TOTAL_DOMAINS = 145_600_000; // domains in this release's graph, as published
export const SHARDS = 4096;

/** FNV-1a: spreads domains evenly over the shard files. */
export function shardOf(domain) {
  let h = 0x811c9dc5;
  for (let i = 0; i < domain.length; i++) h = Math.imul(h ^ domain.charCodeAt(i), 0x01000193) >>> 0;
  return h % SHARDS;
}
export const shardName = (n) => `${String(n).padStart(4, '0')}.tsv`;

/** A line of the ranks file: harmonic position, harmonic value, PageRank position, PageRank value, reversed domain, hosts. */
export function parseLine(line) {
  if (!line || line[0] === '#') return null;
  const f = line.split('\t');
  const harmonicRank = Number(f[0]), pageRank = Number(f[2]);
  if (!(harmonicRank > 0) || !(pageRank > 0) || !f[4]) return null;
  return { domain: f[4].split('.').reverse().join('.'), harmonicRank, pageRank };
}

/**
 * The score, 0–100, on a logarithmic scale: the domain's typical position (geometric mean of the two web-wide rankings)
 * among all domains. Position 1 = 100, the last = 0; every tenfold better position adds the same number of points.
 */
export function authorityScore(harmonicRank, pageRank, total = TOTAL_DOMAINS) {
  const position = Math.sqrt(harmonicRank * pageRank);
  return Math.max(0, Math.min(100, Math.round(100 * (1 - Math.log(position) / Math.log(total)))));
}

/** "blog.example.co.uk" is looked up as itself, then "example.co.uk" (the graph lists registered domains). */
export function candidates(input) {
  const host = String(input || '').trim().toLowerCase().replace(/^https?:\/\//, '').split(/[/?#:]/)[0].replace(/\.$/, '').replace(/^www\./, '');
  if (host.length > 253 || !/^([a-z0-9_-]+\.)+[a-z0-9-]{2,}$/.test(host)) return [];
  const labels = host.split('.');
  return labels.slice(0, -1).map((_, i) => labels.slice(i).join('.'));
}

/** The index built by build-index.mjs, or null. */
export function openIndex(dir) {
  let meta;
  try { meta = JSON.parse(readFileSync(join(dir, 'current.json'), 'utf8')); } catch (_) { return null; }
  const shards = join(dir, meta.folder);
  const find = (domain) => {
    let text;
    try { text = `\n${readFileSync(join(shards, shardName(shardOf(domain))), 'utf8')}`; } catch (_) { return null; }
    const at = text.indexOf(`\n${domain}\t`);
    if (at < 0) return null;
    const [, h, p] = text.slice(at + 1, text.indexOf('\n', at + 1)).split('\t');
    return { harmonicRank: Number(h), pageRank: Number(p) };
  };
  return {
    meta,
    lookup(input) {
      const list = candidates(input);
      if (!list.length) return null;
      for (const matched of list) {
        const hit = find(matched);
        if (hit) return { found: true, domain: list[0], matched, score: authorityScore(hit.harmonicRank, hit.pageRank, meta.total), ...hit, total: meta.total, release: meta.release };
      }
      return { found: false, domain: list[0], indexed: meta.indexed, total: meta.total, release: meta.release };
    },
  };
}
