// Content keywords: the words and short phrases a website actually talks about, counted from its own text.
// Titles and headings count for more than body text. (This is not search-ranking data.)

const STOP = new Set(`a about above after again against all also am an and any are aren't as at be because been before being below between both but by
can can't cannot could couldn't did didn't do does doesn't doing don't down during each even every few for from further get got had hadn't has hasn't have
haven't having he her here hers herself him himself his how however i if in into is isn't it it's its itself just let's like make many may me might more most
much must my myself new no nor not now of off on once one only or other ought our ours ourselves out over own per same shall she should shouldn't so some
such than that that's the their theirs them themselves then there there's these they this those through to too two under until up upon us use used using very
via was wasn't we we're were weren't what what's when where which while who whom why will with within without won't would wouldn't you you're your yours
yourself yourselves click read learn view see contact home page menu search login sign blog back next previous share follow subscribe copyright rights
reserved privacy policy terms cookies cookie accept help need needs want well way ways best top free today`.split(/\s+/));

const tokenize = (s) => (String(s).toLowerCase().replace(/’/g, "'").match(/[\p{L}\p{N}][\p{L}\p{N}'+#.-]*[\p{L}\p{N}+#]|[\p{L}\p{N}]/gu) || []);
const usable = (w) => w.length > 2 && !STOP.has(w) && !/^[\d.,-]+$/.test(w);

/** Adds every 1–3 word phrase of one run of text (a phrase never starts or ends with a filler word). */
function addPhrases(map, text, weight) {
  const words = tokenize(text);
  for (let i = 0; i < words.length; i++) {
    if (!usable(words[i])) continue;
    for (let n = 1; n <= 3 && i + n <= words.length; n++) {
      if (n > 1 && !usable(words[i + n - 1])) continue;
      const term = words.slice(i, i + n).join(' ');
      const e = map.get(term) || { count: 0, weight: 0 };
      e.count++;
      e.weight += weight;
      map.set(term, e);
    }
  }
}

const PER_PAGE = 60;

/** One page → { top: [[term, count, weight]], total: words counted, topShare: share of the most repeated single word }. */
export function pageTerms({ title = '', headings = [], body = '' }) {
  const map = new Map();
  addPhrases(map, title, 4);
  for (const h of headings) addPhrases(map, h.text, h.level === 1 ? 3 : h.level <= 3 ? 2 : 1);
  const total = tokenize(body).length;
  let topWord = '', topCount = 0;
  const bodyMap = new Map();
  // sentence by sentence, so phrases never run across a full stop or a block of text
  for (const part of String(body).split(/[\n.!?;:|•·()[\]{}"“”]+/)) addPhrases(bodyMap, part, 1);
  for (const [term, e] of bodyMap) {
    if (!term.includes(' ') && e.count > topCount) { topWord = term; topCount = e.count; }
    const m = map.get(term) || { count: 0, weight: 0 };
    m.count += e.count;
    m.weight += Math.min(e.weight, 12); // repeating a word many times on one page does not keep adding weight
    map.set(term, m);
  }
  const top = [...map].filter(([, e]) => e.count > 1 || e.weight >= 3).sort((a, b) => b[1].weight - a[1].weight || a[0].localeCompare(b[0])).slice(0, PER_PAGE)
    .map(([term, e]) => [term, e.count, e.weight]);
  return { top, total, topWord, topShare: total ? topCount / total : 0 };
}

/** All pages → { found, top: [{ term, pages, count, score }] } with score 1–100 relative to the strongest term. */
export function siteKeywords(pages, limit = 30) {
  const map = new Map();
  for (const p of pages) {
    for (const [term, count, weight] of (p.terms && p.terms.top) || []) {
      const e = map.get(term) || { term, pages: 0, count: 0, weight: 0 };
      e.pages++;
      e.count += count;
      e.weight += weight;
      map.set(term, e);
    }
  }
  const need = pages.length > 3 ? 3 : 2;
  const real = [...map.values()].filter((e) => e.count >= need);
  // phrases say more than single words, so they rank a little higher
  for (const e of real) e.rank = e.weight * (1 + 0.5 * (e.term.split(' ').length - 1));
  real.sort((a, b) => b.rank - a.rank || a.term.localeCompare(b.term));
  const picked = [];
  for (const e of real) {
    // "app development" already says what "development" would, when they nearly always appear together
    if (picked.some((p) => ` ${p.term} `.includes(` ${e.term} `) && p.count >= e.count * 0.8)) continue;
    picked.push(e);
    if (picked.length >= limit) break;
  }
  const max = picked.length ? picked[0].rank : 1;
  return { found: real.length, top: picked.map((e) => ({ term: e.term, pages: e.pages, count: e.count, score: Math.max(1, Math.round((e.rank / max) * 100)) })) };
}
