// The Domain Authority card: LinkLens's own score, answered by the authority server you run (authority-server/).
import { escapeHtml as esc } from '../shared/helpers.js';

export const OWN_ORIGIN = 'http://127.0.0.1/*';
const ENDPOINT = 'http://127.0.0.1:8787/authority';

export function createOwnAuthority(root) {
  let domain = '';
  let state = {}; // { data } | { loading } | { error }

  function render() {
    const d = state.data;
    const hit = d && d.found;
    const tile = (id, label, value) => `<div class="metric" data-own="${id}"><span>${label}</span><b class="${hit ? '' : 'dim'}">${state.loading ? '<span class="spin" aria-label="Loading"></span>' : esc(hit ? value : '—')}</b></div>`;
    root.innerHTML = `
      <h2>Domain Authority${domain ? ` of <em>${esc(domain)}</em>` : ''}</h2>
      <div class="metrics three">
        ${tile('score', 'DA', hit && d.score)}
        ${tile('harmonic', 'Web Rank (closeness)', hit && `#${d.harmonicRank.toLocaleString('en-US')}`)}
        ${tile('pagerank', 'Web Rank (links)', hit && `#${d.pageRank.toLocaleString('en-US')}`)}
      </div>
      ${d && !d.found ? `<p class="err">${esc(d.domain)} is not among the ${d.indexed.toLocaleString('en-US')} domains in your index. Build a larger index, or the site may be too new or small.</p>` : ''}
      ${state.error ? `<p class="err" role="alert">${esc(state.error)}</p>` : ''}
      <p class="source">Our own score from Common Crawl's map of links between websites${hit ? ` · ${esc(d.release)} · ranked among ${(d.total / 1e6).toFixed(1)} million domains${d.matched !== d.domain ? ` · measured for ${esc(d.matched)}` : ''}` : ''}. Calculated by LinkLens.</p>`;
  }

  async function load(next, { request = false } = {}) {
    if (next !== domain) { domain = next; state = {}; }
    render();
    if (!request || state.loading) return;
    const mine = { loading: true };
    state = mine;
    render();
    let result;
    try {
      const res = await fetch(`${ENDPOINT}?domain=${encodeURIComponent(next)}`, { cache: 'no-store', signal: AbortSignal.timeout(15000) });
      const body = await res.json();
      result = res.ok ? { data: body } : { error: body.error || `The authority server answered with HTTP ${res.status}.` };
    } catch (_) {
      result = { error: 'Your authority server is not running. In the project folder run: npm run authority:build (once), then npm run authority:start' };
    }
    if (next === domain && state === mine) { state = result; render(); }
  }

  render();
  return { load, data: (forDomain) => (forDomain === domain && state.data && state.data.found ? state.data : undefined) };
}
