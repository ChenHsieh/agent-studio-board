// Stats for the studio board: portfolio by verdict, investment by item, changes per day. Reads data/status.json.
const $ = (s) => document.querySelector(s);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const usd = (n) => `$${(n || 0).toFixed(n >= 100 ? 0 : 2)}`;
const PARTS = [
  ['apiUsd', 'Metered API', '#b5562d'],
  ['codexUsdEst', 'Codex (estimate)', '#3c5a7a'],
  ['claudeUsdEst', 'Claude (estimate)', '#6a4f86'],
  ['earlierUsdEst', 'Earlier rounds (estimate)', '#a39b8b'],
];
const COLUMNS = [['ship', 'Ship'], ['revise', 'Revise'], ['shelf', 'Shelf'], ['', 'No verdict yet, with a priority']];

async function load() {
  const r = await fetch(`data/status.json?t=${Date.now()}`, { cache: 'no-store' });
  const d = await r.json();
  const p = d.project || {};
  $('#project').textContent = p.name || '';
  $('#fresh').textContent = `data from ${new Date(d.generated).toLocaleString()}`;
  const games = d.games;
  const rank = (g) => (g.priority || 'P9') + String(1e6 - Math.round(g.cost.totalUsdEst * 100)).padStart(8, '0');

  $('#portfolio').innerHTML = COLUMNS.map(([key, title]) => {
    const list = games.filter((g) => (g.verdict ? g.verdict.verdict === key : key === '' && g.priority && g.priority !== 'P4') || (key === 'shelf' && !g.verdict && g.stage === 'shelf'))
      .sort((a, b) => rank(a).localeCompare(rank(b)));
    if (!list.length) return '';
    return `<div><h3>${title} · ${list.length}</h3><ol>${list.map((g) => `<li><a href="${esc(g.url)}">${esc(g.title)}</a><span>${esc(g.priority || '')} · ${usd(g.cost.totalUsdEst)}</span></li>`).join('')}</ol></div>`;
  }).join('');

  const done = games.flatMap((g) => (g.tasks || []).filter((t) => t.state === 'done').map((t) => ({ ...t, game: g.title })));
  const fine = done.filter((t) => t.reviewOutcome === 'fine');
  const fixed = done.filter((t) => t.reviewOutcome === 'fixed');
  $('#reviews-note').textContent = `${fine.length} fine · ${fixed.length} fixed`;
  $('#reviews').innerHTML = fixed.length
    ? `<p class="review-count"><b>${fixed.length} fixed</b> · ${fine.length} fine</p><ul class="fixed-list">${fixed.map((t) => `<li>${esc(t.title)} · ${esc(t.game)}</li>`).join('')}</ul>`
    : `<p class="review-count">${fine.length} fine · no fixes recorded.</p>`;

  const rates = d.rates || {};
  const workers = new Map();
  for (const t of done) {
    const row = workers.get(t.worker) || { worker: t.worker, done: 0, estimated: 0, total: 0 };
    row.done += 1;
    let estimate = null;
    if (t.worker === 'Codex' && Number.isFinite(t.tokens)) estimate = t.tokens / 1e6 * (rates.codexUsdPerMTok || 0);
    if (t.worker === 'Claude') estimate = rates.claudeUsdPerRun;
    if (Number.isFinite(estimate)) { row.estimated += 1; row.total += estimate; }
    workers.set(t.worker, row);
  }
  const workerRows = [...workers.values()].sort((a, b) => a.worker.localeCompare(b.worker));
  $('#change-cost-note').textContent = 'Estimated dollars per done task, grouped by worker. A dash means the records do not support a task-level estimate.';
  $('#change-cost').innerHTML = workerRows.length ? `<div class="change-cost">${workerRows.map((r) => {
    const each = r.estimated ? usd(r.total / r.estimated) : '—';
    const detail = r.estimated === r.done ? `${r.done} done` : `${r.done} done · ${r.estimated} estimated`;
    return `<div><b>${esc(r.worker)}</b><span>${each} / done task</span><small>${esc(detail)} · ${r.estimated ? usd(r.total) + ' total' : 'no task-level rate'}</small></div>`;
  }).join('')}</div>` : '<p class="review-count">No completed tasks yet.</p>';

  const total = games.reduce((a, g) => a + g.cost.totalUsdEst, 0);
  const top = games.filter((g) => g.cost.totalUsdEst > 0).sort((a, b) => b.cost.totalUsdEst - a.cost.totalUsdEst).slice(0, 25);
  const max = top.length ? top[0].cost.totalUsdEst : 1;
  $('#money-note').textContent = `About ${usd(total)} across ${games.filter((g) => g.cost.totalUsdEst > 0).length} ${p.nounPlural || 'items'}; ${usd(d.apiSpentUsd)} of it was metered API spend, the rest is estimated. The 25 largest are shown.`;
  $('#legend').innerHTML = PARTS.map(([, label, color]) => `<span><i style="background:${color}"></i>${label}</span>`).join('');
  $('#money').innerHTML = top.map((g) => `<div class="bar-row"><span class="lbl">${esc(g.title)}</span><span class="bar" style="width:${(g.cost.totalUsdEst / max) * 100}%">${PARTS.map(([k, , color]) => `<i style="width:${(g.cost[k] / g.cost.totalUsdEst) * 100}%;background:${color}"></i>`).join('')}</span><span class="val">${usd(g.cost.totalUsdEst)}</span></div>`).join('');

  const days = d.activity || [];
  const dmax = Math.max(1, ...days.map((x) => x.changes));
  $('#days').innerHTML = `<div class="days">${days.map((x) => `<div style="height:${(x.changes / dmax) * 100}%"><b>${x.changes}</b></div>`).join('')}</div><div class="daylbl">${days.map((x) => `<span>${x.day.slice(5)}</span>`).join('')}</div>`;

  const rt = rates;
  $('#rates').innerHTML = [
    `Metered API: the actual bill, ${usd(d.apiSpentUsd)} so far.`,
    `Codex: about ${usd(rt.codexUsdPerMTok)} per million tokens. ${esc(rt.codexNote || '')}`,
    `Claude in-session runs: ${usd(rt.claudeUsdPerRun)} each. ${esc(rt.claudeNote || '')}`,
    `Earlier rounds: ${usd(rt.earlierUsdPerRound)} each. ${esc(rt.earlierNote || '')}`,
  ].map((x) => `<li>${x}</li>`).join('');
}
load();
