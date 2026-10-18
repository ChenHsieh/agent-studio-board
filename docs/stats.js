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

  const total = games.reduce((a, g) => a + g.cost.totalUsdEst, 0);
  const top = games.filter((g) => g.cost.totalUsdEst > 0).sort((a, b) => b.cost.totalUsdEst - a.cost.totalUsdEst).slice(0, 25);
  const max = top.length ? top[0].cost.totalUsdEst : 1;
  $('#money-note').textContent = `About ${usd(total)} across ${games.filter((g) => g.cost.totalUsdEst > 0).length} ${p.nounPlural || 'items'}; ${usd(d.apiSpentUsd)} of it was metered API spend, the rest is estimated. The 25 largest are shown.`;
  $('#legend').innerHTML = PARTS.map(([, label, color]) => `<span><i style="background:${color}"></i>${label}</span>`).join('');
  $('#money').innerHTML = top.map((g) => `<div class="bar-row"><span class="lbl">${esc(g.title)}</span><span class="bar" style="width:${(g.cost.totalUsdEst / max) * 100}%">${PARTS.map(([k, , color]) => `<i style="width:${(g.cost[k] / g.cost.totalUsdEst) * 100}%;background:${color}"></i>`).join('')}</span><span class="val">${usd(g.cost.totalUsdEst)}</span></div>`).join('');

  const days = d.activity || [];
  const dmax = Math.max(1, ...days.map((x) => x.changes));
  $('#days').innerHTML = `<div class="days">${days.map((x) => `<div style="height:${(x.changes / dmax) * 100}%"><b>${x.changes}</b></div>`).join('')}</div><div class="daylbl">${days.map((x) => `<span>${x.day.slice(5)}</span>`).join('')}</div>`;

  const rt = d.rates || {};
  $('#rates').innerHTML = [
    `Metered API: the actual bill, ${usd(d.apiSpentUsd)} so far.`,
    `Codex: about ${usd(rt.codexUsdPerMTok)} per million tokens. ${esc(rt.codexNote || '')}`,
    `Claude in-session runs: ${usd(rt.claudeUsdPerRun)} each. ${esc(rt.claudeNote || '')}`,
    `Earlier rounds: ${usd(rt.earlierUsdPerRound)} each. ${esc(rt.earlierNote || '')}`,
  ].map((x) => `<li>${x}</li>`).join('');
}
load();
