// Studio board: a live view of an agent build pipeline. Reads data/status.json, which a script on the build
// machine rewrites and pushes whenever a task moves or an agent commits. No build step, no framework.
const SOURCES = [
  'data/status.json',
  'https://raw.githubusercontent.com/ChenHsieh/agent-studio-board/main/docs/data/status.json',
];
const REFRESH_MS = 90_000;
const PRIO = { P1: 'P1 · flagship', P2: 'P2 · close to great', P3: 'P3 · needs work', P4: 'P4 · shelf' };
const STAGE_ORDER = { building: 0, review: 1, queued: 2, planning: 3, live: 4, shelf: 5 };
const ACTIVE = new Set(['building', 'review', 'queued', 'planning']);
const usd = (n) => `$${(n || 0).toFixed(n >= 100 ? 0 : 2)}`;

let data = null;
let view = localStorage.getItem('board.view') || 'needs';
const open = new Set(JSON.parse(localStorage.getItem('board.open') || '[]'));

const $ = (s) => document.querySelector(s);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

function ago(iso) {
  if (!iso) return '';
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return iso;
  const m = Math.round((Date.now() - t) / 60000);
  if (m < 1) return 'just now';
  if (m < 60) return `${m} min ago`;
  const h = Math.round(m / 60);
  if (h < 36) return `${h} h ago`;
  return `${Math.round(h / 24)} d ago`;
}
function day(iso) {
  const t = Date.parse(iso);
  return Number.isNaN(t) ? String(iso).slice(0, 10) : new Date(t).toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
}

async function load() {
  for (const url of SOURCES) {
    try {
      const r = await fetch(`${url}?t=${Date.now()}`, { cache: 'no-store' });
      if (!r.ok) continue;
      const next = await r.json();
      if (!data || next.generated >= data.generated) data = next;
      render();
      if (url === SOURCES[0]) return;
    } catch { /* try the next source */ }
  }
  $('#fresh').textContent = 'Could not reach the board data. Showing the last copy, if any.';
  $('#fresh').classList.add('stale');
}

function lanesHtml() {
  const lanes = data.lanes || [];
  const rows = lanes.map((l) => {
    const g = data.games.find((x) => x.id === l.game);
    const beat = l.commit ? `last commit ${ago(l.commit.at)}: “${esc(l.commit.subject)}”` : `no commit yet; log active ${ago(l.activity)}`;
    return `<li class="lane"><span class="who">${esc(l.worker)}</span><span class="what"><b>${esc(g ? g.title : l.game)}</b> · ${esc(l.task)}</span><span class="beat">started ${ago(l.since)} · ${beat}</span></li>`;
  });
  const codexIdle = (data.codexLanes || 0) - lanes.filter((l) => l.worker === 'Codex').length;
  for (let i = 0; i < codexIdle; i++) rows.push('<li class="lane idle"><span class="who">Codex</span><span class="what">Idle, waiting for a task</span></li>');
  return rows.join('') || '<li class="lane idle"><span class="who">—</span><span class="what">No agent is working right now.</span></li>';
}

function tallyHtml() {
  const n = {};
  for (const g of data.games) n[g.stage] = (n[g.stage] || 0) + 1;
  const parts = ['building', 'review', 'queued', 'planning', 'shelf', 'live'].filter((s) => n[s]).map((s) => `<span><b>${n[s]}</b> ${s}</span>`);
  const total = data.games.reduce((a, g) => a + (g.cost.totalUsdEst || 0), 0);
  const needs = data.games.filter((g) => g.needsYou).length;
  parts.unshift(`<span><b>${needs}</b> need you</span>`);
  parts.push(`<span><b>≈ ${usd(total)}</b> invested (estimate)</span>`);
  parts.push(`<span><b>${usd(data.apiSpentUsd)}</b> of it metered API</span>`);
  parts.push(`<span><b>${data.houseRules}</b> house rules</span>`);
  return parts.join('');
}

function costLine(c) {
  const bits = [];
  if (c.apiUsd) bits.push(`${usd(c.apiUsd)} metered API (${c.apiRuns || 0} run${c.apiRuns === 1 ? '' : 's'})`);
  if (c.codexRuns) bits.push(`≈ ${usd(c.codexUsdEst)} Codex (${c.codexRuns} run${c.codexRuns === 1 ? '' : 's'}, ${Math.round((c.codexTokens || 0) / 1000)}k tokens)`);
  if (c.claudeRuns) bits.push(`≈ ${usd(c.claudeUsdEst)} Claude (${c.claudeRuns} run${c.claudeRuns === 1 ? '' : 's'})`);
  if (c.earlierRounds) bits.push(`≈ ${usd(c.earlierUsdEst)} earlier rounds (${c.earlierRounds})`);
  return `<b>≈ ${usd(c.totalUsdEst)} invested</b><br>${bits.join('<br>')}`;
}

function gameHtml(g) {
  const img = g.image ? `<img class="thumb" src="${esc(g.image)}" alt="" loading="lazy">` : `<span class="thumb blank" aria-hidden="true">${esc(g.title[0])}</span>`;
  const plans = (g.tasks || []).filter((t) => t.state !== 'done' && t.plan);
  const said = plans.map((t) => `<p class="said">${esc(t.plan)}<small>${esc(t.worker)} · ${esc(t.state === 'running' ? 'building now' : t.state)}</small></p>`).join('');
  const tasks = (g.tasks || []).map((t) => {
    const when = t.state === 'done' ? `done ${ago(t.done)}${t.reviewed ? ', reviewed' : ''}` : t.state === 'running' ? `running since ${ago(t.since)}` : t.state;
    const commit = t.commit ? `<span class="tag">last commit ${ago(t.commit.at)}: “${esc(t.commit.subject)}”</span>` : '';
    const extra = t.state === 'done' && t.result ? `<span class="tag">${esc(t.result)}</span>` : commit;
    return `<li><span class="tag">${esc(t.worker)} · ${esc(when)}</span><br>${esc(t.title)}${extra ? '<br>' + extra : ''}</li>`;
  }).join('');
  const hist = (g.history || []).map((h) => `<li><time>${esc(day(h.at))}</time>${h.ok ? '' : '<span class="no">not done: </span>'}${esc(h.note)}</li>`).join('');
  return `<li class="game${open.has(g.id) ? ' open' : ''}" data-id="${esc(g.id)}">
  <button class="row" aria-expanded="${open.has(g.id)}">${img}<span class="name">${esc(g.title)}</span>
    <span class="meta"><span class="st ${esc(g.stage)}">${esc(g.stage)}</span>${g.verdict ? `<span class="vd ${esc(g.verdict.verdict)}">${esc(g.verdict.verdict)}</span>` : ''}<span class="p">${esc(g.priority || '')}${g.lastChange ? ' · ' + ago(g.lastChange) : ''}</span></span>
    <span class="line">${g.needsYou && view === 'needs' ? '<b class="ask">Needs you:</b> ' + esc(g.needsYou) : esc(g.priorityNote || g.line || '')}</span></button>
  <div class="detail">
    <p><a class="play" href="${esc(g.url)}" target="_blank" rel="noopener">Open ${esc(g.title)} ↗</a></p>
    ${g.line ? `<p>${esc(g.line)}</p>` : ''}
    <p class="cost">${costLine(g.cost)}</p>
    ${g.needsYou ? `<p class="said">${esc(g.needsYou)}<small>Waiting for a human</small></p>` : ''}
    ${g.verdict ? `<p class="said">${esc(g.verdict.verdict)}: ${esc(g.verdict.note)}<small>Verdict, ${esc(g.verdict.date)}</small></p>` : ''}
    ${g.shelfNote ? `<p class="said">${esc(g.shelfNote)}<small>Why it is on the shelf</small></p>` : ''}
    ${said ? '<h3>Plan</h3>' + said : ''}
    ${tasks ? '<h3>Tasks</h3><ul class="tasks">' + tasks + '</ul>' : ''}
    ${hist ? '<h3>Changes</h3><ul class="hist">' + hist + '</ul>' : ''}
  </div></li>`;
}

function render() {
  const p = data.project || {};
  $('#project').textContent = p.name || '';
  $('#blurb').innerHTML = p.blurb ? `${esc(p.blurb)} ${p.url ? `<a href="${esc(p.url)}">Open ${esc(p.name)}</a>` : ''}` : '';
  document.title = `Studio board · ${p.name || ''}`;
  const fresh = $('#fresh');
  fresh.textContent = `Last change ${ago(data.generated)} · ${data.games.length} ${(data.project && data.project.nounPlural) || 'items'}`;
  fresh.classList.remove('stale');
  $('#lanes').innerHTML = lanesHtml();
  $('#tally').innerHTML = tallyHtml();
  for (const b of document.querySelectorAll('.seg button')) b.setAttribute('aria-pressed', String(b.dataset.view === view));
  const q = $('#q').value.trim().toLowerCase();
  let list = data.games.filter((g) => !q || (g.title + ' ' + g.id + ' ' + (g.line || '')).toLowerCase().includes(q));
  if (!q) {
    if (view === 'needs') list = list.filter((g) => g.needsYou);
    if (view === 'active') list = list.filter((g) => ACTIVE.has(g.stage));
    if (view === 'shelf') list = list.filter((g) => g.stage === 'shelf' || g.priority === 'P4');
    if (view === 'priority') list = list.filter((g) => g.priority);
  }
  const byStage = (a, b) => STAGE_ORDER[a.stage] - STAGE_ORDER[b.stage] || (a.priority || 'P9').localeCompare(b.priority || 'P9') || (b.lastChange || '').localeCompare(a.lastChange || '');
  let html = '';
  if (view === 'priority' && !q) {
    for (const p of ['P1', 'P2', 'P3', 'P4']) {
      const group = list.filter((g) => g.priority === p).sort(byStage);
      if (group.length) html += `<li class="prio-h">${PRIO[p]}</li>` + group.map(gameHtml).join('');
    }
  } else if (view === 'all' && !q) {
    list.sort((a, b) => (b.lastChange || '').localeCompare(a.lastChange || ''));
    html = list.map(gameHtml).join('');
  } else {
    html = list.sort(byStage).map(gameHtml).join('');
  }
  $('#games').innerHTML = html || '<li class="empty">Nothing here right now.</li>';
}

document.addEventListener('click', (e) => {
  const seg = e.target.closest('.seg button');
  if (seg) { view = seg.dataset.view; localStorage.setItem('board.view', view); render(); return; }
  const row = e.target.closest('.game > button.row');
  if (row) {
    const id = row.parentElement.dataset.id;
    open.has(id) ? open.delete(id) : open.add(id);
    localStorage.setItem('board.open', JSON.stringify([...open]));
    row.parentElement.classList.toggle('open');
    row.setAttribute('aria-expanded', String(open.has(id)));
  }
});
$('#q').addEventListener('input', () => data && render());
load();
setInterval(load, REFRESH_MS);
setInterval(() => data && ($('#fresh').textContent = `Last change ${ago(data.generated)} · ${data.games.length} ${(data.project && data.project.nounPlural) || 'items'}`), 30_000);
