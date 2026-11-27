// The "discovered and lost" bar chart (one pair of bars per scan): gained bars go up, lost bars go down. Plain SVG, no library.

const NS = 'http://www.w3.org/2000/svg';
const H = 260, LEFT = 46, RIGHT = 10, TOP = 12, BOTTOM = 28;

const el = (tag, attrs = {}, text) => {
  const n = document.createElementNS(NS, tag);
  for (const [k, v] of Object.entries(attrs)) n.setAttribute(k, v);
  if (text != null) n.textContent = text;
  return n;
};

/** A round gridline distance giving about `lines` lines across `span`. */
export function niceStep(span, lines = 6) {
  const raw = Math.max(span, 1) / lines;
  const pow = 10 ** Math.floor(Math.log10(raw));
  const f = raw / pow;
  return Math.max(1, (f <= 1 ? 1 : f <= 2 ? 2 : f <= 5 ? 5 : 10) * pow);
}

const short = (date) => `${date.slice(5, 7)}/${date.slice(8, 10)}`;

/** Draws into `box` at its current width. `series`: [{ date, gained, lost }], oldest first. */
export function drawChart(box, series) {
  box.textContent = '';
  const W = Math.max(320, Math.round(box.clientWidth || 800));
  const up = Math.max(...series.map((d) => d.gained), 1);
  const down = Math.max(...series.map((d) => d.lost), 1);
  const step = niceStep(up + down);
  const max = Math.ceil(up / step) * step, min = -Math.ceil(down / step) * step;
  const plotW = W - LEFT - RIGHT, plotH = H - TOP - BOTTOM;
  const y = (v) => TOP + ((max - v) / (max - min)) * plotH;
  const slot = plotW / series.length;
  const bar = Math.max(1.5, Math.min(18, slot * 0.7));

  const svg = el('svg', { viewBox: `0 0 ${W} ${H}`, width: W, height: H, role: 'img' });
  const total = (k) => series.reduce((n, d) => n + d[k], 0);
  svg.setAttribute('aria-label', `Changes from ${series[0].date} to ${series[series.length - 1].date}: ${total('gained')} discovered, ${total('lost')} lost.`);

  for (let v = min; v <= max; v += step) {
    svg.appendChild(el('line', { class: v === 0 ? 'zero' : 'grid', x1: LEFT, x2: W - RIGHT, y1: y(v), y2: y(v) }));
    svg.appendChild(el('text', { class: 'tick', x: LEFT - 8, y: y(v) + 4, 'text-anchor': 'end' }, String(v)));
  }
  const every = Math.max(1, Math.ceil(56 / slot)); // as many date labels as fit
  series.forEach((d, i) => {
    const cx = LEFT + slot * i + slot / 2;
    if (i % every === 0) svg.appendChild(el('text', { class: 'tick', x: cx, y: H - 8, 'text-anchor': 'middle' }, short(d.date)));
  });

  const hover = el('rect', { class: 'hover', y: TOP, height: plotH, width: slot, x: 0, visibility: 'hidden' });
  svg.appendChild(hover);
  series.forEach((d, i) => {
    const x = LEFT + slot * i + (slot - bar) / 2;
    if (d.gained) svg.appendChild(el('rect', { class: 'gained', x, y: y(d.gained), width: bar, height: y(0) - y(d.gained) }));
    if (d.lost) svg.appendChild(el('rect', { class: 'lost', x, y: y(0), width: bar, height: y(-d.lost) - y(0) }));
  });
  box.appendChild(svg);

  const tip = document.createElement('div');
  tip.className = 'tip';
  tip.hidden = true;
  box.appendChild(tip);
  svg.addEventListener('mousemove', (e) => {
    const r = svg.getBoundingClientRect();
    const px = ((e.clientX - r.left) / r.width) * W;
    const i = Math.floor((px - LEFT) / slot);
    if (i < 0 || i >= series.length) { tip.hidden = true; hover.setAttribute('visibility', 'hidden'); return; }
    const d = series[i];
    hover.setAttribute('x', LEFT + slot * i);
    hover.setAttribute('visibility', 'visible');
    tip.innerHTML = '';
    for (const [cls, text] of [['d', d.date], ['g', `${d.gained} discovered`], ['l', `${d.lost} lost`]]) {
      const line = document.createElement('span');
      line.className = cls;
      line.textContent = text;
      tip.appendChild(line);
    }
    tip.hidden = false;
    const cx = ((LEFT + slot * i + slot / 2) / W) * r.width;
    tip.style.left = `${Math.min(Math.max(cx, 64), r.width - 64)}px`;
  });
  svg.addEventListener('mouseleave', () => { tip.hidden = true; hover.setAttribute('visibility', 'hidden'); });
}
