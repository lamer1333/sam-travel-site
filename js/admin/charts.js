// ---------------------------------------------------------------------------
// Dependency-free SVG charts. Rules (dataviz): one y-axis, 2px lines, bars
// ≤24px with 4px rounded data-end, hairline grid, legend for ≥2 series,
// hover tooltip on every plotted form, text in ink tokens — never series colour.
// Rendered at the container's real pixel width and re-rendered on resize.
// ---------------------------------------------------------------------------
import { h, fmt, clear } from './ui.js';

const NS = 'http://www.w3.org/2000/svg';
const s = (tag, attrs = {}) => { const e = document.createElementNS(NS, tag); for (const k in attrs) e.setAttribute(k, attrs[k]); return e; };
export const SERIES = ['var(--s1)', 'var(--s2)', 'var(--s3)', 'var(--s4)', 'var(--s5)', 'var(--s6)', 'var(--s7)', 'var(--s8)'];

function niceMax(v) {
  if (v <= 0) return 4;
  const p = Math.pow(10, Math.floor(Math.log10(v))), n = v / p;
  return (n <= 1 ? 1 : n <= 2 ? 2 : n <= 2.5 ? 2.5 : n <= 5 ? 5 : 10) * p;
}
function responsive(el, draw) {
  let w = 0;
  const ro = new ResizeObserver(() => { const nw = Math.round(el.clientWidth); if (nw && nw !== w) { w = nw; draw(w); } });
  ro.observe(el);
  requestAnimationFrame(() => { if (!w && el.clientWidth) { w = el.clientWidth; draw(w); } });
}
function legend(series) {
  if (series.length < 2) return null;
  return h('div.legend', series.map((x) => h('span', h('i', { class: x.type === 'line' ? 'line' : '', style: { background: x.color } }), x.name)));
}

/** Time series. series: [{name, values:[], color, type:'bar'|'line'|'area'}], labels: ISO dates */
export function timeChart({ labels, series, height = 220, fmtY = fmt.compact, fmtTip = fmt.num }) {
  const box = h('div.chart');
  const wrap = h('div', legend(series), box);
  responsive(box, (W) => {
    clear(box);
    const H = height, L = 38, R = 8, T = 10, B = 26;
    const iw = W - L - R, ih = H - T - B, n = labels.length || 1;
    const stacked = series.filter((x) => x.type === 'bar');
    const max = niceMax(Math.max(1, ...labels.map((_, i) => stacked.reduce((a, x) => a + (x.values[i] || 0), 0)),
      ...series.filter((x) => x.type !== 'bar').flatMap((x) => x.values)));
    const X = (i) => L + (n === 1 ? iw / 2 : (i + 0.5) * iw / n), Y = (v) => T + ih - (v / max) * ih;
    const svg = s('svg', { width: W, height: H, viewBox: `0 0 ${W} ${H}`, role: 'img', 'aria-label': series.map((x) => x.name).join(', ') });
    const grid = s('g', { class: 'grid' }), axis = s('g', { class: 'axis' });
    for (let k = 0; k <= 4; k++) {
      const v = max * k / 4, y = Y(v);
      grid.appendChild(s('line', { x1: L, x2: W - R, y1: y, y2: y }));
      const t = s('text', { x: L - 8, y: y + 4, 'text-anchor': 'end' }); t.textContent = fmtY(v); axis.appendChild(t);
    }
    const every = Math.max(1, Math.ceil(n / Math.max(2, Math.floor(iw / 64))));
    labels.forEach((d, i) => { if (i % every) return; const t = s('text', { x: X(i), y: H - 6, 'text-anchor': 'middle' }); t.textContent = fmt.day(d); axis.appendChild(t); });
    svg.append(grid, axis);
    // bars (stacked, 2px surface gap between segments)
    const bw = Math.min(24, Math.max(2, iw / n - 4));
    labels.forEach((_, i) => {
      let acc = 0;
      stacked.forEach((x, si) => {
        const v = x.values[i] || 0; if (!v) return;
        const y0 = Y(acc), y1 = Y(acc + v); acc += v;
        const hgt = Math.max(1, y0 - y1 - (si ? 2 : 0));
        const top = si === stacked.length - 1 || !stacked.slice(si + 1).some((z) => z.values[i]);
        const r = top ? Math.min(4, bw / 2, hgt) : 0;
        const x0 = X(i) - bw / 2;
        const path = `M${x0},${y1 + hgt} V${y1 + r} Q${x0},${y1} ${x0 + r},${y1} H${x0 + bw - r} Q${x0 + bw},${y1} ${x0 + bw},${y1 + r} V${y1 + hgt} Z`;
        svg.appendChild(s('path', { d: path, fill: x.color }));
      });
    });
    // lines / areas
    series.filter((x) => x.type !== 'bar').forEach((x) => {
      const pts = x.values.map((v, i) => [X(i), Y(v || 0)]);
      if (x.type === 'area') svg.appendChild(s('path', { d: `M${pts[0][0]},${Y(0)} ` + pts.map((p) => `L${p[0]},${p[1]}`).join(' ') + ` L${pts[pts.length - 1][0]},${Y(0)} Z`, fill: x.color, 'fill-opacity': 0.1 }));
      svg.appendChild(s('path', { d: pts.map((p, i) => (i ? 'L' : 'M') + p[0] + ',' + p[1]).join(' '), fill: 'none', stroke: x.color, 'stroke-width': 2, 'stroke-linejoin': 'round', 'stroke-linecap': 'round' }));
      const last = pts[pts.length - 1];
      if (last) svg.appendChild(s('circle', { cx: last[0], cy: last[1], r: 4, fill: x.color, stroke: 'var(--surface)', 'stroke-width': 2 }));
    });
    // hover: crosshair + tooltip
    const cross = s('line', { class: 'cross', y1: T, y2: T + ih, visibility: 'hidden' });
    const hit = s('rect', { class: 'hit', x: L, y: T, width: iw, height: ih });
    svg.append(cross, hit);
    const tip = h('div.tip', { hidden: true });
    function show(ev) {
      const rect = svg.getBoundingClientRect(), mx = (ev.touches ? ev.touches[0].clientX : ev.clientX) - rect.left;
      const i = Math.max(0, Math.min(n - 1, Math.floor((mx - L) / (iw / n))));
      cross.setAttribute('x1', X(i)); cross.setAttribute('x2', X(i)); cross.setAttribute('visibility', 'visible');
      tip.hidden = false; clear(tip);
      tip.append(h('b', fmt.date(labels[i])), ...series.map((x) => h('div', h('i', { style: { background: x.color } }), x.name + ': ' + fmtTip(x.values[i] || 0))));
      tip.style.left = Math.min(W - 70, Math.max(70, X(i))) + 'px'; tip.style.top = T + 'px';
    }
    hit.addEventListener('mousemove', show); hit.addEventListener('touchstart', show, { passive: true });
    hit.addEventListener('mouseleave', () => { tip.hidden = true; cross.setAttribute('visibility', 'hidden'); });
    box.append(svg, tip);
  });
  return wrap;
}

/** Horizontal bar list. items: [{label, value, value2?, note?}] */
export function barList(items, { fmtV = fmt.num, color = 'var(--s1)', color2 = 'var(--s3)', label2, label1, max, limit = 8, empty = 'Нет данных' } = {}) {
  const list = items.slice(0, limit);
  if (!list.length) return h('div.empty', empty);
  const m = max || Math.max(1, ...list.map((x) => Math.max(x.value, x.value2 || 0)));
  return h('div',
    label2 ? h('div.legend', h('span', h('i', { style: { background: color } }), label1 || 'Значение'), h('span', h('i', { style: { background: color2 } }), label2)) : null,
    h('div.bars', list.map((x) => h('div.bar', { title: x.label + ': ' + fmtV(x.value) + (x.value2 != null ? ' · ' + (label2 || '') + ' ' + fmtV(x.value2) : '') },
      h('span.bar__label', x.label),
      h('span.bar__track', h('span.bar__fill', { style: { width: (x.value / m * 100) + '%', background: color } }),
        x.value2 != null ? h('span.bar__fill.bar__fill--2', { style: { width: (x.value2 / m * 100) + '%', background: color2 } }) : null),
      h('span.bar__val', x.note != null ? x.note : fmtV(x.value) + (x.value2 != null ? ' / ' + fmtV(x.value2) : ''))))));
}

/** Funnel: ordinal blue ramp, conversion from previous step */
export function funnel(steps) {
  const top = Math.max(1, steps[0] ? steps[0].value : 1);
  const ramp = ['var(--seq-6)', 'var(--seq-5)', 'var(--seq-4)', 'var(--seq-3)', 'var(--s3)', 'var(--s6)'];
  return h('div.funnel', steps.map((st, i) => {
    const prev = i ? steps[i - 1].value : null;
    return h('div.funnel__row', { title: st.hint || '' },
      h('span', st.label),
      h('span.funnel__bar', h('span.funnel__fill', { style: { width: Math.max(0.5, st.value / top * 100) + '%', background: ramp[Math.min(i, ramp.length - 1)] } })),
      h('span.funnel__val', h('b', fmt.num(st.value)), h('small', i ? fmt.pct(prev ? st.value / prev : 0) + ' от пред.' : '100%')));
  }));
}

/** Day-of-week × hour heatmap. cells: [{dow 1-7, h 0-23, v}] */
export function heatmap(cells, { unit = '' } = {}) {
  const grid = {}; let max = 0;
  cells.forEach((c) => { grid[c.dow + ':' + c.h] = c.v; max = Math.max(max, c.v); });
  const days = ['Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб', 'Вс'];
  const steps = ['var(--seq-1)', 'var(--seq-2)', 'var(--seq-3)', 'var(--seq-4)', 'var(--seq-5)', 'var(--seq-6)'];
  const el = h('div.heat', { role: 'img', 'aria-label': 'Тепловая карта по дням недели и часам' });
  el.appendChild(h('em'));
  for (let hr = 0; hr < 24; hr++) el.appendChild(h('b', hr % 3 ? '' : String(hr)));
  days.forEach((d, di) => {
    el.appendChild(h('em', d));
    for (let hr = 0; hr < 24; hr++) {
      const v = grid[(di + 1) + ':' + hr] || 0;
      el.appendChild(h('span', { title: `${d}, ${hr}:00–${hr + 1}:00 — ${v} ${unit}`, style: v ? { background: steps[Math.min(5, Math.floor(v / max * 5.999))] } : null }));
    }
  });
  return el;
}
export function heatPeak(cells) {
  const days = ['понедельник', 'вторник', 'среду', 'четверг', 'пятницу', 'субботу', 'воскресенье'];
  const best = cells.slice().sort((a, b) => b.v - a.v)[0];
  return best ? `Пик — ${days[best.dow - 1]}, ${best.h}:00–${best.h + 1}:00` : '';
}

export function sparkline(values, { width = 96, height = 28, color = 'var(--s1)' } = {}) {
  const svg = s('svg', { width, height, viewBox: `0 0 ${width} ${height}`, class: 'spark', 'aria-hidden': 'true' });
  if (!values || values.length < 2) return svg;
  const max = Math.max(1, ...values), n = values.length;
  const pts = values.map((v, i) => [i / (n - 1) * (width - 4) + 2, height - 3 - (v / max) * (height - 6)]);
  svg.appendChild(s('path', { d: `M${pts[0][0]},${height} ` + pts.map((p) => `L${p[0]},${p[1]}`).join(' ') + ` L${pts[n - 1][0]},${height} Z`, fill: color, 'fill-opacity': 0.1 }));
  svg.appendChild(s('path', { d: pts.map((p, i) => (i ? 'L' : 'M') + p[0].toFixed(1) + ',' + p[1].toFixed(1)).join(' '), fill: 'none', stroke: color, 'stroke-width': 2, 'stroke-linecap': 'round', 'stroke-linejoin': 'round' }));
  svg.appendChild(s('circle', { cx: pts[n - 1][0], cy: pts[n - 1][1], r: 3, fill: color }));
  return svg;
}

/** 100% stacked bar + legend. parts: [{label, value, color}] */
export function stackBar(parts, { fmtV = fmt.num } = {}) {
  const tot = parts.reduce((a, p) => a + p.value, 0) || 1;
  const live = parts.filter((p) => p.value > 0);
  return h('div',
    h('div.stackbar', live.map((p) => h('span', { style: { flex: p.value, background: p.color }, title: p.label + ': ' + fmtV(p.value) + ' (' + fmt.pct(p.value / tot, 0) + ')' }))),
    h('div.legend', { style: { marginTop: '10px', marginBottom: 0 } }, parts.map((p) => h('span', h('i', { style: { background: p.color } }), p.label + ' ', h('b', fmtV(p.value)), h('span.muted', ' · ' + fmt.pct(p.value / tot, 0))))));
}

/** Progress ring for a 0..1 score */
export function ring(v, { size = 120, label } = {}) {
  const r = size / 2 - 9, c = 2 * Math.PI * r;
  const col = v >= 0.85 ? 'var(--ok)' : v >= 0.6 ? 'var(--warn)' : 'var(--bad)';
  const svg = s('svg', { width: size, height: size, viewBox: `0 0 ${size} ${size}`, class: 'ring', role: 'img', 'aria-label': label || fmt.pct(v, 0) });
  svg.appendChild(s('circle', { cx: size / 2, cy: size / 2, r, fill: 'none', stroke: 'var(--surface-3)', 'stroke-width': 10 }));
  svg.appendChild(s('circle', { cx: size / 2, cy: size / 2, r, fill: 'none', stroke: col, 'stroke-width': 10, 'stroke-linecap': 'round', 'stroke-dasharray': c, 'stroke-dashoffset': c * (1 - v), transform: `rotate(-90 ${size / 2} ${size / 2})` }));
  const t = s('text', { x: size / 2, y: size / 2 + 8, 'text-anchor': 'middle', 'font-size': 24, 'font-weight': 700, fill: 'var(--ink)' }); t.textContent = Math.round(v * 100) + '%';
  svg.appendChild(t);
  return svg;
}

/** KPI tile: label, value, delta vs previous (goodUp decides colour), sparkline */
export function kpi({ label, value, unit, prev, cur, goodUp = true, spark, hint, hero, iconEl }) {
  let d = null;
  if (prev != null && cur != null) {
    if (!prev && !cur) d = h('span.delta.delta--flat', '—');
    else if (!prev) d = h('span.delta.delta--up', 'новое');
    else {
      const ch = (cur - prev) / Math.abs(prev), up = ch > 0.005, down = ch < -0.005;
      const good = (up && goodUp) || (down && !goodUp);
      d = h('span.delta' + (!up && !down ? '.delta--flat' : good ? '.delta--up' : '.delta--down'), { title: 'к прошлому периоду: ' + prev },
        (up ? '▲ ' : down ? '▼ ' : '') + fmt.pct(Math.abs(ch), 0));
    }
  }
  return h('div.kpi' + (hero ? '.kpi--hero' : ''), { title: hint || '' },
    h('span.kpi__label', iconEl || null, label),
    h('span.kpi__value', value, unit ? h('small', unit) : null),
    h('span.kpi__foot', d || h('span.delta.delta--flat', hint ? '' : ''), spark ? sparkline(spark) : null));
}
