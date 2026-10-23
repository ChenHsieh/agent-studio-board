/* Idea graph: draws docs/data/graph.json (public-safe fields only), seeded random walks, remix prompts. No libraries. */
(function () {
'use strict';
var RESTART = 0.12, MINS = 4, MAXS = 7;
var NS = 'http://www.w3.org/2000/svg';
var FAM = { K1: '#E69F00', K2: '#56B4E9', K3: '#009E73', K4: '#F0E442', K5: '#0072B2', K6: '#CC79A7', K7: '#882255', K8: '#DDDDDD' };
var KIND = { source: 'source reading', idea: 'idea', lens: 'lens', game: 'game' };
var STAGE = { idea: 'idea', building: 'building', playable: 'playable', ship: 'ready to ship', released: 'released', shelf: 'shelved' };
var ROUND = { r2: 'Round 2 readings', r4: 'Round 4', r5: 'Round 5', trace: 'Games', backlog: 'Backlog', board: 'Board shelf' };
var EDGE = { hand: 'hand link', parent: 'came from', keyword: 'shared tag words', words: 'similar wording', lens: 'shared lens' };
var MOVES = ['invert', 'swap scale', 'swap the verb', 'change who wins', 'remove the text', 'make the rule the joke'];

var $ = function (id) { return document.getElementById(id); };
function el(tag, attrs, parent) { var e = document.createElementNS(NS, tag); for (var k in attrs) e.setAttribute(k, attrs[k]); if (parent) parent.appendChild(e); return e; }
function h(tag, attrs, text) { var e = document.createElement(tag); for (var k in (attrs || {})) e.setAttribute(k, attrs[k]); if (text != null) e.textContent = text; return e; }
function mulberry32(a) { return function () { a |= 0; a = a + 0x6D2B79F5 | 0; var t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; }; }

var G = null, byId = {}, adj = {}, adjSet = {}, fam = {}, pos = {}, nodeEls = {}, baseLines = [];
var view = { k: 1, tx: 0, ty: 0 }, sel = null, walk = null, startId = null, locked = 0, cands = [], filt = { kind: new Set(), stage: new Set(), round: new Set(), lens: '' };
var svg, gBase, gSel, gWalk, gNodes, gBadges, gLabel, W = 400, H = 400;

/* ---------- data ---------- */
function load(data) {
  G = data;
  G.nodes.forEach(function (n) { byId[n.id] = n; adj[n.id] = []; });
  G.edges.forEach(function (e) {
    if (!byId[e.a] || !byId[e.b]) return;
    adj[e.a].push({ id: e.b, w: e.weight, kind: e.kind, why: e.why }); adj[e.b].push({ id: e.a, w: e.weight, kind: e.kind, why: e.why });
    adjSet[e.a + '|' + e.b] = 1; adjSet[e.b + '|' + e.a] = 1;
  });
  Object.keys(adj).forEach(function (k) { adj[k].sort(function (x, y) { return x.id < y.id ? -1 : x.id > y.id ? 1 : x.kind < y.kind ? -1 : 1; }); });
  G.nodes.forEach(function (n) { if (n.cluster && FAM[n.cluster]) fam[n.id] = n.cluster; });
  G.nodes.forEach(function (n) {
    if (fam[n.id] || n.kind === 'lens') return;
    var v = {}; adj[n.id].forEach(function (x) { var f = byId[x.id].cluster; if (FAM[f]) v[f] = (v[f] || 0) + x.w; });
    var best = null; Object.keys(v).sort().forEach(function (f) { if (best === null || v[f] > v[best]) best = f; });
    if (best) fam[n.id] = best;
  });
}

/* ---------- layout: seeded force layout, run once ---------- */
function layout() {
  var rng = mulberry32(20261023), ids = G.nodes.map(function (n) { return n.id; }), n = ids.length, i, j;
  var x = new Float64Array(n), y = new Float64Array(n), idx = {};
  var fk = Object.keys(FAM);
  ids.forEach(function (id, a) { idx[id] = a; var f = fam[id], ang = (f ? fk.indexOf(f) / fk.length : rng()) * 6.2832 + rng() * 0.6; var r = 200 + rng() * 260; x[a] = Math.cos(ang) * r; y[a] = Math.sin(ang) * r; });
  var E = G.edges.filter(function (e) { return idx[e.a] != null && idx[e.b] != null; }).map(function (e) {
    var s = (e.kind === 'hand' || e.kind === 'parent') ? 1 : e.kind === 'lens' ? 0.04 : e.kind === 'words' ? 0.25 : Math.min(e.weight, 3) / 8; return [idx[e.a], idx[e.b], s]; });
  var kk = 46, it, T = 120;
  for (it = 0; it < 320; it++) {
    var dx = new Float64Array(n), dy = new Float64Array(n);
    for (i = 0; i < n; i++) for (j = i + 1; j < n; j++) {
      var ex = x[i] - x[j], ey = y[i] - y[j], d2 = ex * ex + ey * ey + 0.01, f = kk * kk / d2;
      dx[i] += ex * f; dy[i] += ey * f; dx[j] -= ex * f; dy[j] -= ey * f;
    }
    E.forEach(function (e) {
      var ex = x[e[0]] - x[e[1]], ey = y[e[0]] - y[e[1]], d = Math.sqrt(ex * ex + ey * ey) + 0.01, f = d / kk * e[2];
      dx[e[0]] -= ex * f; dy[e[0]] -= ey * f; dx[e[1]] += ex * f; dy[e[1]] += ey * f;
    });
    for (i = 0; i < n; i++) {
      dx[i] -= x[i] * 0.012; dy[i] -= y[i] * 0.012;
      var m = Math.sqrt(dx[i] * dx[i] + dy[i] * dy[i]) + 0.01, s = Math.min(m, T) / m; x[i] += dx[i] * s; y[i] += dy[i] * s;
    }
    T = Math.max(2, T * 0.985);
  }
  ids.forEach(function (id, a) { pos[id] = [x[a], y[a]]; });
}

/* ---------- view ---------- */
function bounds() { var a = 1e9, b = 1e9, c = -1e9, d = -1e9; Object.keys(pos).forEach(function (k) { var p = pos[k]; a = Math.min(a, p[0]); b = Math.min(b, p[1]); c = Math.max(c, p[0]); d = Math.max(d, p[1]); }); return [a, b, c, d]; }
function fit() { var bb = bounds(), m = 24, k = Math.min((W - 2 * m) / (bb[2] - bb[0]), (H - 2 * m) / (bb[3] - bb[1])); view.k = k; view.k0 = k; view.tx = W / 2 - k * (bb[0] + bb[2]) / 2; view.ty = H / 2 - k * (bb[1] + bb[3]) / 2; render(); }
function sx(id) { return pos[id][0] * view.k + view.tx; }
function sy(id) { return pos[id][1] * view.k + view.ty; }
function zoomAt(f, cx, cy) { var nk = Math.max(0.25, Math.min(view.k * f, 60)); f = nk / view.k; view.tx = cx - (cx - view.tx) * f; view.ty = cy - (cy - view.ty) * f; view.k = nk; render(); }

/* ---------- shapes ---------- */
function shapePath(kind, s) {
  if (kind === 'idea') return 'M' + (-s) + ',' + (-s) + 'h' + 2 * s + 'v' + 2 * s + 'h' + (-2 * s) + 'z';
  if (kind === 'lens') return 'M0,' + (-s * 1.35) + 'L' + s * 1.35 + ',0L0,' + s * 1.35 + 'L' + (-s * 1.35) + ',0z';
  if (kind === 'game') return 'M0,' + (-s * 1.3) + 'L' + s * 1.2 + ',' + s * 0.9 + 'L' + (-s * 1.2) + ',' + s * 0.9 + 'z';
  return 'M' + (-s) + ',0a' + s + ',' + s + ' 0 1,0 ' + 2 * s + ',0a' + s + ',' + s + ' 0 1,0 ' + (-2 * s) + ',0z';
}
function famColour(n) { return FAM[fam[n.id]] || '#F6F2E8'; }
/* fill = idea family colour, always. Stage is the outline: idea none, building dotted ring, playable thin ring, ship thick ring,
   released double ring, shelved = dashed hollow shape. */
function drawShape(g, n, s) {
  var st = n.stage, ink = '#1d1b17';
  if (st === 'building') el('path', { d: shapePath(n.kind, s + 3), fill: 'none', stroke: ink, 'stroke-width': 1.6, 'stroke-dasharray': '1.5 2.5' }, g);
  if (st === 'playable') el('path', { d: shapePath(n.kind, s + 3), fill: 'none', stroke: ink, 'stroke-width': 1.3 }, g);
  if (st === 'ship') el('path', { d: shapePath(n.kind, s + 3), fill: 'none', stroke: ink, 'stroke-width': 3 }, g);
  if (st === 'released') { el('path', { d: shapePath(n.kind, s + 3), fill: 'none', stroke: ink, 'stroke-width': 1.5 }, g); el('path', { d: shapePath(n.kind, s + 5.5), fill: 'none', stroke: ink, 'stroke-width': 1.5 }, g); }
  var p = el('path', { d: shapePath(n.kind, s), fill: n.kind === 'lens' ? '#FBF8F1' : famColour(n), stroke: ink, 'stroke-width': 1.6 }, g);
  if (st === 'shelf') { p.setAttribute('fill', '#FBF8F1'); p.setAttribute('stroke-dasharray', '3 2'); p.setAttribute('stroke-width', 2); }
  return p;
}

/* ---------- build svg ---------- */
function build() {
  svg = $('svg'); svg.innerHTML = '';
  gBase = el('g', {}, svg); gSel = el('g', {}, svg); gWalk = el('g', {}, svg); gNodes = el('g', {}, svg); gBadges = el('g', {}, svg); gLabel = el('g', {}, svg);
  G.edges.forEach(function (e) { if ((e.kind === 'hand' || e.kind === 'parent') && pos[e.a] && pos[e.b]) { var l = el('line', { stroke: '#b9b09c', 'stroke-width': 1, 'stroke-opacity': 0.55 }, gBase); l._e = e; baseLines.push(l); } });
  G.nodes.forEach(function (n) { var g = el('g', { 'data-id': n.id }, gNodes); drawShape(g, n, 4.5); nodeEls[n.id] = g; });
  resize();
}
function resize() { var r = $('wrap').getBoundingClientRect(); W = Math.max(200, r.width); H = Math.max(200, r.height); svg.setAttribute('viewBox', '0 0 ' + W + ' ' + H); if (!view._set) { view._set = true; fit(); } else render(); }

function visible(n) {
  if (filt.kind.size && !filt.kind.has(n.kind)) return false;
  if (filt.stage.size && !filt.stage.has(n.stage)) return false;
  if (filt.round.size && !filt.round.has(n.round)) return false;
  if (filt.lens && n.lenses.indexOf(filt.lens) < 0 && n.label !== filt.lens) return false;
  return true;
}
function render() {
  if (!G) return;
  baseLines.forEach(function (l) { l.setAttribute('x1', sx(l._e.a)); l.setAttribute('y1', sy(l._e.a)); l.setAttribute('x2', sx(l._e.b)); l.setAttribute('y2', sy(l._e.b)); });
  var sf = Math.max(1, Math.min(2.4, Math.sqrt(view.k / (view.k0 || view.k)))), onwalk = {}; if (walk) walk.path.forEach(function (id) { onwalk[id] = 1; });
  G.nodes.forEach(function (n) { var g = nodeEls[n.id]; g.setAttribute('transform', 'translate(' + sx(n.id).toFixed(1) + ',' + sy(n.id).toFixed(1) + ') scale(' + sf.toFixed(2) + ')'); g.setAttribute('opacity', visible(n) ? (walk && !onwalk[n.id] ? 0.45 : 1) : 0.1); });
  // selected node: its links and ring
  gSel.innerHTML = ''; gLabel.innerHTML = '';
  if (sel) {
    adj[sel].forEach(function (x) { el('line', { x1: sx(sel), y1: sy(sel), x2: sx(x.id), y2: sy(x.id), stroke: '#b5562d', 'stroke-width': x.kind === 'hand' || x.kind === 'parent' ? 2 : 1, 'stroke-opacity': 0.45 }, gSel); });
    el('circle', { cx: sx(sel), cy: sy(sel), r: 15, fill: 'none', stroke: '#b5562d', 'stroke-width': 3 }, gSel);
    var t = el('text', { x: sx(sel), y: sy(sel) - 22, 'text-anchor': sx(sel) < 120 ? 'start' : sx(sel) > W - 120 ? 'end' : 'middle', 'font-size': 18, fill: '#1d1b17', stroke: '#fffdf8', 'stroke-width': 5, 'paint-order': 'stroke', 'font-family': 'Georgia,serif' }, gLabel);
    t.textContent = byId[sel].label;
  }
  gWalk.innerHTML = ''; gBadges.innerHTML = '';
  if (walk) {
    var p = walk.path;
    for (var i = 1; i < p.length; i++) {
      var jump = !adjSet[p[i - 1] + '|' + p[i]];
      el('line', { x1: sx(p[i - 1]), y1: sy(p[i - 1]), x2: sx(p[i]), y2: sy(p[i]), stroke: '#fffdf8', 'stroke-width': 7 }, gWalk);
      el('line', { x1: sx(p[i - 1]), y1: sy(p[i - 1]), x2: sx(p[i]), y2: sy(p[i]), stroke: '#b5562d', 'stroke-width': 3.5, 'stroke-dasharray': jump ? '7 5' : '' }, gWalk);
    }
    var seen = {};
    p.forEach(function (id, i) {
      var c = seen[id] = (seen[id] || 0) + 1, ox = (c - 1) * 16;
      var g = el('g', { transform: 'translate(' + (sx(id) + 12 + ox) + ',' + (sy(id) - 12) + ')' }, gBadges);
      el('circle', { r: 12, fill: i <= locked ? '#1d1b17' : '#fffdf8', stroke: '#1d1b17', 'stroke-width': 2 }, g);
      var tx = el('text', { 'text-anchor': 'middle', y: 6, 'font-size': 18, fill: i <= locked ? '#fffdf8' : '#1d1b17', 'font-family': 'ui-monospace,Menlo,monospace' }, g); tx.textContent = i === 0 ? 'S' : i;
    });
  }
}

/* ---------- pointer: pan, pinch, tap ---------- */
function setupPointer() {
  var pts = new Map(), moved = 0, last = null, pinch = null;
  var w = $('wrap');
  function local(e) { var r = w.getBoundingClientRect(); return [e.clientX - r.left, e.clientY - r.top]; }
  w.addEventListener('pointerdown', function (e) { w.setPointerCapture(e.pointerId); pts.set(e.pointerId, local(e)); moved = 0; if (pts.size === 2) { var a = Array.from(pts.values()); pinch = { d: Math.hypot(a[0][0] - a[1][0], a[0][1] - a[1][1]) }; } });
  w.addEventListener('pointermove', function (e) {
    if (!pts.has(e.pointerId)) return; var p = local(e), o = pts.get(e.pointerId);
    if (pts.size === 1) { view.tx += p[0] - o[0]; view.ty += p[1] - o[1]; moved += Math.abs(p[0] - o[0]) + Math.abs(p[1] - o[1]); pts.set(e.pointerId, p); render(); }
    else if (pts.size === 2) { pts.set(e.pointerId, p); var a = Array.from(pts.values()), d = Math.hypot(a[0][0] - a[1][0], a[0][1] - a[1][1]); if (pinch && pinch.d > 0) zoomAt(d / pinch.d, (a[0][0] + a[1][0]) / 2, (a[0][1] + a[1][1]) / 2); pinch = { d: d }; moved = 99; }
  });
  function up(e) {
    if (!pts.has(e.pointerId)) return; var p = pts.get(e.pointerId); pts.delete(e.pointerId); pinch = null;
    if (moved < 8 && pts.size === 0) pick(p[0], p[1]);
  }
  w.addEventListener('pointerup', up); w.addEventListener('pointercancel', function (e) { pts.delete(e.pointerId); pinch = null; });
  w.addEventListener('wheel', function (e) { e.preventDefault(); var p = local(e); zoomAt(e.deltaY < 0 ? 1.2 : 1 / 1.2, p[0], p[1]); }, { passive: false });
  $('zin').onclick = function () { zoomAt(1.4, W / 2, H / 2); }; $('zout').onclick = function () { zoomAt(1 / 1.4, W / 2, H / 2); }; $('zfit').onclick = fit;
  svg.addEventListener('keydown', function (e) { var s = 40; if (e.key === '+' || e.key === '=') zoomAt(1.3, W / 2, H / 2); else if (e.key === '-') zoomAt(1 / 1.3, W / 2, H / 2); else if (e.key === 'ArrowLeft') { view.tx += s; render(); } else if (e.key === 'ArrowRight') { view.tx -= s; render(); } else if (e.key === 'ArrowUp') { view.ty += s; render(); } else if (e.key === 'ArrowDown') { view.ty -= s; render(); } });
}
function pick(px, py) {
  var best = null, bd = 34 * 34;
  G.nodes.forEach(function (n) { var dx = sx(n.id) - px, dy = sy(n.id) - py, d = dx * dx + dy * dy; if (d < bd && visible(n)) { bd = d; best = n.id; } });
  if (best) select(best);
}

/* ---------- card ---------- */
function famName(n) { var c = n.cluster; return c ? (G.clusters[c] || c) : 'none (a lens)'; }
function select(id, noScroll) {
  sel = id; var n = byId[id], body = $('cardbody'); body.innerHTML = '';
  body.appendChild(h('p', { 'class': 'card-title' }, n.label));
  body.appendChild(h('p', { 'class': 'meta' }, KIND[n.kind] + ' · ' + STAGE[n.stage] + ' · ' + (ROUND[n.round] || n.round)));
  body.appendChild(h('p', { 'class': 'meta' }, 'Cluster: ' + famName(n) + (fam[id] && n.cluster !== fam[id] ? ' (nearest family: ' + G.clusters[fam[id]] + ')' : '')));
  body.appendChild(h('p', {}, n.idea));
  if (n.lenses.length) body.appendChild(h('p', { 'class': 'meta' }, 'Lenses: ' + n.lenses.join('; ')));
  var b = h('button', { type: 'button', 'class': 'primary' }, 'Start a walk here'); b.onclick = function () { startId = id; updateStartLine(); newWalk(); }; body.appendChild(b);
  var nb = adj[id].slice().sort(function (a, c) { return c.w - a.w || (a.id < c.id ? -1 : 1); }).slice(0, 8);
  if (nb.length) { body.appendChild(h('h3', {}, 'Linked to')); var ul = h('ul', { 'class': 'neigh' });
    nb.forEach(function (x) { var li = h('li'), bt = h('button', { type: 'button' }); bt.appendChild(document.createTextNode(byId[x.id].label)); bt.appendChild(h('div', { 'class': 'k' }, (EDGE[x.kind] || x.kind) + (x.why ? ': ' + x.why : ''))); bt.onclick = function () { select(x.id); focusOn(x.id); }; li.appendChild(bt); ul.appendChild(li); }); body.appendChild(ul); }
  render(); fillRemix();
}
function focusOn(id) { var x = sx(id), y = sy(id); view.tx += W / 2 - x; view.ty += H / 2 - y; render(); }

/* ---------- walks ---------- */
function pickNext(cur, r, bias) {
  var nb = adj[cur]; if (!nb.length) return null;
  var tot = 0, ws = nb.map(function (x) { var w = x.w * (bias && byId[x.id].round === 'r5' ? 5 : 1); tot += w; return w; });
  var t = r() * tot; for (var i = 0; i < nb.length; i++) { t -= ws[i]; if (t <= 0) return nb[i].id; } return nb[nb.length - 1].id;
}
function walkPath(seed, start, steps, prefix, mode) {
  var r = mulberry32(seed); if (steps == null) steps = MINS + Math.floor(r() * (MAXS - MINS + 1));
  var path = prefix && prefix.length ? prefix.slice() : [start], revive = mode === 'rev';
  while (path.length < steps + 1) {
    var cur = path[path.length - 1];
    if (!revive && r() < RESTART) path.push(start);
    else { var nx = pickNext(cur, r, revive); path.push(nx == null ? start : nx); }
  }
  return { seed: seed, start: start, steps: steps, path: path, prefix: prefix || [], mode: mode || '' };
}
function crossed(path) { var s = {}; path.forEach(function (id) { var c = byId[id].cluster; if (c && c !== 'unsorted') s[c] = 1; }); return Object.keys(s).length; }
function randStart(r) { var ids = G.nodes.filter(function (n) { return n.kind !== 'lens' && adj[n.id].length; }).map(function (n) { return n.id; }); return ids[Math.floor(r() * ids.length)]; }
function newSeed() { return 1 + Math.floor(Math.random() * 900000); }
function updateStartLine() { $('startline').textContent = 'Start: ' + (startId ? byId[startId].label : 'a random node'); }

function setWalk(w, keepCands) {
  walk = w; locked = Math.max(0, (w.prefix.length || 1) - 1); if (!keepCands) { cands = []; }
  renderWalk(); writeHash(); render(); fillRemix();
}
function newWalk() {
  var base = newSeed(), start = startId || randStart(Math.random);
  cands = []; for (var i = 0; i < 8; i++) cands.push(walkPath(base + i, start, null, null));
  var best = cands[0]; cands.forEach(function (c) { if (crossed(c.path) > crossed(best.path)) best = c; });
  setWalk(best, true);
}
function reroll() {
  if (!walk) return newWalk();
  var pre = walk.path.slice(0, locked + 1), w = walkPath(newSeed(), walk.start, walk.steps, pre.length > 1 ? pre : null, walk.mode);
  w.prefix = pre.length > 1 ? pre : []; cands = []; setWalk(w, true);
}
function stepAgain() {
  if (!walk || walk.steps >= MAXS) return;
  var w = walkPath(newSeed(), walk.start, walk.steps + 1, walk.path, walk.mode); setWalk(w, true);
}
function savedWalks() {
  var arr = G.walks.map(function (w, i) { return { seed: w.seed, start: w.start, steps: w.steps, path: w.path, prefix: [], mode: 'saved', idx: i }; });
  arr.sort(function (a, b) { return crossed(b.path) - crossed(a.path) || a.idx - b.idx; });
  cands = arr.slice(0, 8); setWalk(cands[0], true); startId = cands[0].start; updateStartLine();
}
function revive() {
  var shelf = G.nodes.filter(function (n) { return n.stage === 'shelf' && adj[n.id].length; }).map(function (n) { return n.id; });
  if (!shelf.length) return;
  var base = newSeed(), start = shelf[Math.floor(Math.random() * shelf.length)], found = null, last = null;
  for (var i = 0; i < 60 && !found; i++) {
    var w = walkPath(base + i, start, MAXS, null, 'rev'); last = w;
    for (var s = 1; s < w.path.length; s++) if (byId[w.path[s]].round === 'r5' && s >= 2) { found = walkPath(base + i, start, s, null, 'rev'); break; }
  }
  startId = start; updateStartLine(); cands = []; setWalk(found || last, true);
}
function renderWalk() {
  var ol = $('steps'); ol.innerHTML = '';
  if (!walk) { $('seedline').textContent = ''; return; }
  walk.path.forEach(function (id, i) {
    var n = byId[id], li = h('li', i <= locked ? { 'class': 'locked' } : {}), jump = i > 0 && !adjSet[walk.path[i - 1] + '|' + id];
    if (jump) li.className += ' restart';
    li.appendChild(h('span', { 'class': 'n' }, i === 0 ? 'S' : String(i)));
    var lb = h('button', { type: 'button', 'class': 'lbl' }, n.label); lb.onclick = function () { select(id); focusOn(id); }; li.appendChild(lb);
    if (i > 0 && i < walk.path.length) { var lk = h('button', { type: 'button', 'class': 'lock', 'aria-pressed': i <= locked ? 'true' : 'false' }, i === locked ? 'Unlock' : 'Lock to here'); lk.onclick = function () { locked = (i === locked) ? 0 : i; renderWalk(); writeHash(); render(); }; li.appendChild(lk); } else li.appendChild(h('span'));
    ol.appendChild(li);
  });
  var cr = crossed(walk.path);
  var modeTxt = walk.mode === 'saved' ? ' (saved walk, built by the Python rule)' : walk.mode === 'rev' ? ' (revive: leaning toward round 5)' : '';
  $('seedline').textContent = 'Seed ' + walk.seed + ' · ' + walk.steps + ' steps · crosses ' + cr + ' cluster' + (cr === 1 ? '' : 's') + (locked ? ' · locked through step ' + locked : '') + modeTxt;
  var ch = $('candh'), ul = $('cands'); ul.innerHTML = ''; ch.hidden = !cands.length;
  var mx = 0; cands.forEach(function (c) { mx = Math.max(mx, crossed(c.path)); });
  cands.forEach(function (c) {
    var li = h('li'), b = h('button', { type: 'button', 'aria-current': c === walk ? 'true' : 'false' }), k = crossed(c.path);
    b.appendChild(document.createTextNode('Seed ' + c.seed + ' · ' + c.steps + ' steps · ' + k + ' cluster' + (k === 1 ? '' : 's')));
    if (k === mx && mx > 0) b.appendChild(h('span', { 'class': 'tag' }, 'most clusters'));
    b.onclick = function () { walk = c; locked = 0; renderWalk(); writeHash(); render(); fillRemix(); }; li.appendChild(b); ul.appendChild(li);
  });
  $('bstep').disabled = walk.steps >= MAXS;
}
function writeHash() {
  if (!walk) return;
  var hsh = walk.mode === 'saved' ? '#saved=' + walk.idx : '#walk=' + [walk.seed, walk.start, walk.steps, (locked ? walk.path.slice(0, locked + 1) : walk.prefix.length > 1 ? walk.prefix : []).join(','), walk.mode].join(':');
  try { history.replaceState(null, '', hsh); } catch (e) { /* ignore */ }
}
function readHash() {
  var m = /^#walk=(\d+):([^:]+):(\d+):([^:]*):?(\w*)$/.exec(location.hash || ''), s = /^#saved=(\d+)$/.exec(location.hash || '');
  if (m && byId[m[2]]) { var pre = m[4] ? m[4].split(',') : []; var w = walkPath(+m[1], m[2], +m[3], pre.length > 1 ? pre : null, m[5]); w.prefix = pre.length > 1 ? pre : []; startId = m[2]; updateStartLine(); setWalk(w); }
  else if (s && G.walks[+s[1]]) { var sw = G.walks[+s[1]]; startId = sw.start; updateStartLine(); setWalk({ seed: sw.seed, start: sw.start, steps: sw.steps, path: sw.path, prefix: [], mode: 'saved', idx: +s[1] }); }
}

/* ---------- remix ---------- */
var move = MOVES[0];
function fillRemix() {
  var A = $('selA'), B = $('selB'), ids = [], seen = {};
  (walk ? walk.path : sel ? [sel].concat(adj[sel].slice(0, 5).map(function (x) { return x.id; })) : []).forEach(function (id) { if (!seen[id]) { seen[id] = 1; ids.push(id); } });
  var a0 = A.value, b0 = B.value; A.innerHTML = ''; B.innerHTML = '';
  ids.forEach(function (id) { A.appendChild(h('option', { value: id }, byId[id].label)); B.appendChild(h('option', { value: id }, byId[id].label)); });
  if (ids.length) { A.value = ids.indexOf(a0) >= 0 ? a0 : ids[0]; B.value = ids.indexOf(b0) >= 0 && b0 !== A.value ? b0 : (ids[ids.length - 1] !== A.value ? ids[ids.length - 1] : ids[1] || ids[0]); }
  writePrompt();
}
function writePrompt() {
  var A = $('selA').value, B = $('selB').value;
  $('prompt').value = A && B ? 'Take ' + byId[A].label + ' + ' + byId[B].label + ', apply ' + move + ': what is the one decision?' : 'Make a walk or open a node first.';
}
function buildMoves() {
  var box = $('moves'); box.innerHTML = '';
  MOVES.forEach(function (m) { var b = h('button', { type: 'button', 'aria-pressed': m === move ? 'true' : 'false' }, m); b.onclick = function () { move = m; Array.prototype.forEach.call(box.children, function (c) { c.setAttribute('aria-pressed', c === b ? 'true' : 'false'); }); writePrompt(); }; box.appendChild(b); });
  $('selA').onchange = $('selB').onchange = writePrompt;
  $('bcopy').onclick = function () {
    var t = $('prompt').value, done = function (ok) { $('copied').textContent = ok ? 'Copied.' : 'Select the text and copy it by hand.'; };
    if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(t).then(function () { done(true); }, function () { fallback(); }); else fallback();
    function fallback() { var ta = $('prompt'); ta.removeAttribute('readonly'); ta.select(); var ok = false; try { ok = document.execCommand('copy'); } catch (e) { /* ignore */ } ta.setAttribute('readonly', ''); done(ok); }
  };
  var note = $('note'); try { note.value = localStorage.getItem('igNote') || ''; } catch (e) { /* ignore */ }
  note.addEventListener('input', function () { try { localStorage.setItem('igNote', note.value); } catch (e) { /* ignore */ } });
}

/* ---------- filters, search, legend ---------- */
function chips() {
  [['kind', Object.keys(KIND), KIND], ['stage', Object.keys(STAGE), STAGE], ['round', Object.keys(ROUND), ROUND]].forEach(function (d) {
    var box = document.querySelector('[data-f="' + d[0] + '"]'); box.innerHTML = '';
    d[1].forEach(function (v) { var b = h('button', { type: 'button', 'aria-pressed': 'false' }, d[2][v]); b.onclick = function () { var s = filt[d[0]]; if (s.has(v)) s['delete'](v); else s.add(v); b.setAttribute('aria-pressed', s.has(v) ? 'true' : 'false'); filtChanged(); }; box.appendChild(b); });
  });
  var lens = {}; G.nodes.forEach(function (n) { n.lenses.forEach(function (l) { lens[l] = 1; }); if (n.kind === 'lens') lens[n.label] = 1; });
  var sl = $('lensf'); Object.keys(lens).sort().forEach(function (l) { sl.appendChild(h('option', { value: l }, l)); });
  sl.onchange = function () { filt.lens = sl.value; filtChanged(); };
  $('fclear').onclick = function () { filt.kind.clear(); filt.stage.clear(); filt.round.clear(); filt.lens = ''; sl.value = ''; chips2off(); filtChanged(); };
}
function chips2off() { Array.prototype.forEach.call(document.querySelectorAll('.filters .chips button'), function (b) { b.setAttribute('aria-pressed', 'false'); }); }
function filtChanged() { var c = filt.kind.size + filt.stage.size + filt.round.size + (filt.lens ? 1 : 0); $('fcount').textContent = c ? '(' + c + ' on)' : ''; var shown = G.nodes.filter(visible).length; $('fcount').textContent += (c ? ' · ' : ' · ') + shown + ' of ' + G.nodes.length + ' shown'; render(); }
function search() {
  var q = $('q'), ul = $('results');
  q.addEventListener('input', function () {
    var t = q.value.trim().toLowerCase(); ul.innerHTML = ''; if (t.length < 2) return;
    G.nodes.filter(function (n) { return n.label.toLowerCase().indexOf(t) >= 0 || n.idea.toLowerCase().indexOf(t) >= 0; }).slice(0, 6).forEach(function (n) {
      var li = h('li'), b = h('button', { type: 'button' }, n.label + ' (' + KIND[n.kind] + ')'); b.onclick = function () { select(n.id); focusOn(n.id); }; li.appendChild(b); ul.appendChild(li); });
    if (!ul.children.length) ul.appendChild(h('li', { 'class': 'muted' }, 'Nothing matches.'));
  });
}
function legend() {
  var box = $('legend'); box.innerHTML = '';
  function item(kind, stage, colour, text) { var s = document.createElementNS(NS, 'svg'); s.setAttribute('viewBox', '-14 -14 28 28'); var g = el('g', {}, s); var n = { id: 'x', kind: kind, stage: stage, cluster: null }; fam.x = colour; drawShape(g, n, 6); delete fam.x; var sp = h('span'); sp.appendChild(s); sp.appendChild(document.createTextNode(text)); box.appendChild(sp); }
  box.appendChild(h('div', { 'class': 'grp' }, 'Shape is the kind'));
  item('source', 'ship', 'K3', 'source reading'); item('idea', 'ship', 'K3', 'idea'); item('lens', 'ship', 'K3', 'lens'); item('game', 'ship', 'K3', 'game');
  box.appendChild(h('div', { 'class': 'grp' }, 'Outline is how far it got'));
  ['idea', 'building', 'playable', 'ship', 'released', 'shelf'].forEach(function (st) { item('source', st, 'K3', STAGE[st]); });
  box.appendChild(h('div', { 'class': 'grp' }, 'Colour is the idea family (its name is on the card)'));
  Object.keys(FAM).forEach(function (k) { item('source', 'ship', k, G.clusters[k]); });
}

/* ---------- start ---------- */
function start(data) {
  load(data); layout(); build(); setupPointer(); chips(); search(); legend(); buildMoves(); updateStartLine(); filtChanged();
  $('bnew').onclick = newWalk; $('breroll').onclick = reroll; $('bstep').onclick = stepAgain; $('bsaved').onclick = savedWalks; $('brevive').onclick = revive;
  var kinds = {}; G.nodes.forEach(function (n) { kinds[n.kind] = (kinds[n.kind] || 0) + 1; });
  $('lead').textContent = G.nodes.length + ' nodes and ' + G.edges.length + ' links: readings from rounds 2, 4 and 5, the game list, and the shelf. Dashed links in a walk are jumps back to the start.';
  window.addEventListener('resize', resize); readHash();
  window.IG = { data: G, walkPath: walkPath, crossed: crossed, state: function () { return { walk: walk, locked: locked, sel: sel, cands: cands }; }, select: select, newWalk: newWalk, revive: revive, savedWalks: savedWalks, reroll: reroll, stepAgain: stepAgain, pos: pos, view: view };
}
fetch('data/graph.json', { cache: 'no-cache' }).then(function (r) { if (!r.ok) throw new Error('HTTP ' + r.status); return r.json(); }).then(start).catch(function (e) { $('lead').textContent = 'The graph data could not be loaded (' + e.message + ').'; });
})();
