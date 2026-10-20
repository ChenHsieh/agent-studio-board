// Studio board: a live view of an agent build pipeline. Reads data/status.json, which a script on the build
// machine rewrites and pushes whenever a task moves or an agent commits. No build step, no framework.
const SOURCES = [
  'data/status.json',
  'https://raw.githubusercontent.com/ChenHsieh/agent-studio-board/main/docs/data/status.json',
];
const REFRESH_MS = 90_000;
const STAGE_ORDER = { building: 0, review: 1, queued: 2, planning: 3, live: 4, shelf: 5 };
const FILTERS = {
  stage: [['building', 'Building'], ['review', 'Review'], ['queued', 'Queued'], ['planning', 'Planning'], ['live', 'Live'], ['shelf', 'Shelf']],
  priority: [['P1', 'P1'], ['P2', 'P2'], ['P3', 'P3'], ['P4', 'P4']],
  verdict: [['ship', 'Ship'], ['revise', 'Revise'], ['shelf', 'Shelf'], ['none', 'None']],
  worker: [['Codex', 'Codex'], ['Claude', 'Claude']],
  recent: [['arrived', 'Recently arrived'], ['updated-24', 'Updated 24 h'], ['updated-7', 'Updated 7 d']],
};
const usd = (n) => `$${(n || 0).toFixed(n >= 100 ? 0 : 2)}`;

let data = null;
const open = new Set(JSON.parse(localStorage.getItem('board.open') || '[]'));
const savedFilters = JSON.parse(localStorage.getItem('board.filters') || '{}');
let filters = { stage: [], priority: [], verdict: [], worker: [], recent: [], ...savedFilters };
delete filters.needs;
// The first-row view switch. Needs you is the default; the last choice is remembered.
const VIEWS = [['needs', 'Needs you'], ['ready', 'Ready to try'], ['progress', 'In progress'], ['shelf', 'Shelf'], ['all', 'All']];
let view = localStorage.getItem('board.view');
if (!VIEWS.some(([v]) => v === view)) view = 'needs';
// Needs you means: a human is the only thing the game is waiting for (the server sets needsYou only when no work is queued).
// inProgress comes from the server; older data files derive it from the task counts.
const inProg = (g) => g.inProgress ?? (((g.taskCounts || {}).queued || 0) + ((g.taskCounts || {}).running || 0) > 0);
const isReady = (g) => g.stage === 'live' && !inProg(g) && (!g.verdict || (g.lastChange && g.verdict.date && g.lastChange.slice(0, 10) > g.verdict.date));
const IN_VIEW = {
  needs: (g) => !!g.needsYou,
  ready: isReady,
  progress: (g) => !!inProg(g),
  shelf: (g) => g.stage === 'shelf',
  all: () => true,
};
// Why a game needs Chen: a new version to play, an open question, or a decision.
function whyKind(g) {
  const t = g.needsYou || '';
  if (/^new version/i.test(t)) return ['version', 'A new version to try'];
  if (t.includes('?')) return ['question', 'Has an open question'];
  return ['decision', 'A decision is waiting'];
}
const WHY_ORDER = { decision: 0, version: 1, question: 2 };
function whatToDo(g) {
  if (g.needsYou) return g.needsYou;
  if (view === 'ready' && isReady(g)) return 'Play it, then give a verdict: ship, revise or shelf.';
  return g.priorityNote || g.line || '';
}
let sort = localStorage.getItem('board.sort') || 'change';

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
function within(iso, hours) { const t = Date.parse(iso || ''); return !Number.isNaN(t) && Date.now() - t <= hours * 3_600_000; }
function saveChoices() { localStorage.setItem('board.view', view); localStorage.setItem('board.filters', JSON.stringify(filters)); localStorage.setItem('board.sort', sort); }

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

function queueHtml() {
  const rows = (data.queue && data.queue.workers) || {};
  return ['Codex', 'Claude'].map((worker) => {
    const n = rows[worker] || {};
    const total = (n.queued || 0) + (n.running || 0) + (n.doneToday || 0);
    const width = (part) => total ? `${(part || 0) / total * 100}%` : '0%';
    const label = `${worker}: ${n.queued || 0} queued, ${n.running || 0} running, ${n.doneToday || 0} done today`;
    return `<div class="queue-row"><span class="queue-worker">${worker}</span><div class="queue-track" role="img" aria-label="${esc(label)}"><i class="q-queued" style="width:${width(n.queued)}"></i><i class="q-running" style="width:${width(n.running)}"></i><i class="q-done" style="width:${width(n.doneToday)}"></i></div><span class="queue-count">Q ${n.queued || 0} · R ${n.running || 0} · D ${n.doneToday || 0}</span></div>`;
  }).join('');
}

function tallyHtml() {
  const n = {};
  for (const g of data.games) n[g.stage] = (n[g.stage] || 0) + 1;
  const parts = ['building', 'review', 'queued', 'planning', 'shelf', 'live'].filter((s) => n[s]).map((s) => `<span><b>${n[s]}</b> ${s}</span>`);
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

function taskCounts(g) {
  const n = g.taskCounts || {};
  return `<span class="task-counts" aria-label="Task status: ${n.queued || 0} queued, ${n.running || 0} running, ${n.waitingDesign || 0} waiting for design, ${n.done || 0} done">Queued ${n.queued || 0} · Running ${n.running || 0} · Waiting design ${n.waitingDesign || 0} · Done ${n.done || 0}</span>`;
}

function gameHtml(g) {
  const img = g.image ? `<img class="thumb" src="${esc(g.image)}" alt="" loading="lazy">` : `<span class="thumb blank" aria-hidden="true">${esc(g.title[0])}</span>`;
  const repoUrl = `https://github.com/ChenHsieh/${encodeURIComponent(g.repo || g.id)}`;
  const plans = (g.tasks || []).filter((t) => t.state !== 'done' && t.plan);
  const said = plans.map((t) => `<p class="said">${esc(t.plan)}<small>${esc(t.worker)} · ${esc(t.state === 'running' ? 'building now' : t.state)}</small></p>`).join('');
  const tasks = (g.tasks || []).map((t) => {
    const when = t.state === 'done' ? `done ${ago(t.done)}${t.reviewed ? ', reviewed' : ''}` : t.state === 'running' ? `running since ${ago(t.since)}` : t.state;
    const commit = t.commit ? `<span class="tag">last commit ${ago(t.commit.at)}: “${esc(t.commit.subject)}”</span>` : '';
    const extra = t.state === 'done' && t.result ? `<span class="tag">${esc(t.result)}</span>` : commit;
    return `<li><span class="tag">${esc(t.worker)} · ${esc(when)}</span><br>${esc(t.title)}${extra ? '<br>' + extra : ''}</li>`;
  }).join('');
  const hist = (g.history || []).map((h) => `<li><time>${esc(day(h.at))}</time>${h.ok ? '' : '<span class="no">not done: </span>'}${esc(h.note)}${h.source ? `<small class="history-source">${esc(h.source)}</small>` : ''}</li>`).join('');
  return `<li class="game${open.has(g.id) ? ' open' : ''}" data-id="${esc(g.id)}">
  <button class="row" aria-expanded="${open.has(g.id)}">${img}<span class="name">${esc(g.title)}</span>
    <span class="meta"><span class="st ${esc(g.stage)}">${esc(g.stage)}</span>${g.verdict ? `<span class="vd ${esc(g.verdict.verdict)}">${esc(g.verdict.verdict)}</span>` : ''}<span class="p">${esc(g.priority || '')}</span></span>
    <span class="line">${g.needsYou ? '<b class="ask">To do:</b> ' : ''}${esc(whatToDo(g))}</span></button>
  <a class="play-link" href="${esc(g.url)}" target="_blank" rel="noopener" aria-label="Play ${esc(g.title)}">Play</a>
  <div class="detail">
    <p class="detail-links"><a href="${esc(g.url)}" target="_blank" rel="noopener">Play</a><a href="${esc(repoUrl)}" target="_blank" rel="noopener">Repo</a></p>
    ${g.line ? `<p>${esc(g.line)}</p>` : ''}
    <p class="cost">${costLine(g.cost)}</p>
    ${g.needsYou ? `<p class="said">${esc(g.needsYou)}<small>Waiting for a human</small></p>` : ''}
    ${g.verdict ? `<p class="said">${esc(g.verdict.verdict)}: ${esc(g.verdict.note)}<small>Verdict, ${esc(g.verdict.date)}</small></p>` : ''}
    ${g.shelfNote ? `<p class="said">${esc(g.shelfNote)}<small>Why it is on the shelf</small></p>` : ''}
    ${said ? '<h3>Plan</h3>' + said : ''}
    <h3>Task status</h3><p class="task-summary">${taskCounts(g)}</p>
    ${tasks ? '<h3>Tasks</h3><ul class="tasks">' + tasks + '</ul>' : ''}
    ${hist ? '<h3>Changelog</h3><ul class="hist">' + hist + '</ul>' : ''}
  </div></li>`;
}

function renderViews() {
  $('#views').innerHTML = VIEWS.map(([v, label]) => `<button class="view" role="tab" data-view="${v}" aria-selected="${v === view}">${label} <b>${data.games.filter(IN_VIEW[v]).length}</b></button>`).join('');
}

function renderChips() {
  for (const [group, choices] of Object.entries(FILTERS)) {
    document.querySelector(`[data-chips="${group}"]`).innerHTML = choices.map(([value, label]) => `<button class="chip" data-filter="${group}" data-value="${value}" aria-pressed="${filters[group].includes(value)}">${label}</button>`).join('');
  }
  const count = Object.values(filters).reduce((n, values) => n + values.length, 0);
  $('#filter-count').textContent = count ? `(${count})` : '';
}

function matches(g) {
  const any = (value, values) => !values.length || values.includes(value);
  if (!any(g.stage, filters.stage) || !any(g.priority || 'none', filters.priority) || !any(g.verdict ? g.verdict.verdict : 'none', filters.verdict)) return false;
  if (filters.worker.length && !filters.worker.some((worker) => (g.tasks || []).some((t) => t.worker === worker))) return false;
  if (filters.recent.length && !filters.recent.some((value) => (value === 'arrived' && within(g.firstSeen, 24 * 7)) || (value === 'updated-24' && within(g.lastChange, 24)) || (value === 'updated-7' && within(g.lastChange, 24 * 7)))) return false;
  return true;
}

function compare(a, b) {
  if (view === 'needs') return WHY_ORDER[whyKind(a)[0]] - WHY_ORDER[whyKind(b)[0]] || (a.priority || 'P9').localeCompare(b.priority || 'P9') || (b.lastChange || '').localeCompare(a.lastChange || '');
  if (sort === 'priority') return (a.priority || 'P9').localeCompare(b.priority || 'P9') || (b.lastChange || '').localeCompare(a.lastChange || '');
  if (sort === 'cost') return (b.cost.totalUsdEst || 0) - (a.cost.totalUsdEst || 0) || (b.lastChange || '').localeCompare(a.lastChange || '');
  return (b.lastChange || '').localeCompare(a.lastChange || '') || STAGE_ORDER[a.stage] - STAGE_ORDER[b.stage];
}

function render() {
  const p = data.project || {};
  $('#project').textContent = p.name || '';
  document.title = `Studio board · ${p.name || ''}`;
  const fresh = $('#fresh');
  fresh.textContent = `Last change ${ago(data.generated)} · ${data.games.length} ${(data.project && data.project.nounPlural) || 'items'}`;
  fresh.classList.remove('stale');
  $('#queue').innerHTML = queueHtml();
  const queue = data.queue || {};
  $('#queue-eta').textContent = queue.estimateMinutes ? `Est. finish ${day(queue.estimatedFinish)}` : 'Queue clear';
  $('#lanes').innerHTML = lanesHtml();
  $('#tally').innerHTML = tallyHtml();
  $('#sort').value = sort;
  renderChips();
  const q = $('#q').value.trim().toLowerCase();
  renderViews();
  const list = data.games.filter((g) => (!q || (g.title + ' ' + g.id + ' ' + (g.line || '')).toLowerCase().includes(q)) && IN_VIEW[view](g) && matches(g)).sort(compare);
  let html = '', lastGroup = '';
  for (const g of list) {
    if (view === 'needs') { const [key, label] = whyKind(g); if (key !== lastGroup) { html += `<li class="prio-h" role="presentation">${label}</li>`; lastGroup = key; } }
    html += gameHtml(g);
  }
  const emptyText = { needs: 'Nothing is waiting for you. Try “Ready to try”.', ready: 'No new version is waiting to be tried.', progress: 'Nothing is queued or running.', shelf: 'The shelf is empty.', all: '' }[view];
  $('#games').innerHTML = html || `<li class="empty">${emptyText || 'Nothing matches.'}</li>`;
}

document.addEventListener('click', (e) => {
  const tab = e.target.closest('[data-view]');
  if (tab && data) { view = tab.dataset.view; saveChoices(); render(); return; }
  const chip = e.target.closest('.chip');
  if (chip) {
    const { filter, value } = chip.dataset;
    filters[filter] = filters[filter].includes(value) ? filters[filter].filter((v) => v !== value) : [...filters[filter], value];
    saveChoices(); render(); return;
  }
  const expand = e.target.closest('[data-expand]');
  if (expand && data) {
    open.clear();
    if (expand.dataset.expand === 'all') data.games.forEach((g) => open.add(g.id));
    localStorage.setItem('board.open', JSON.stringify([...open])); render(); return;
  }
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
$('#sort').addEventListener('change', (e) => { sort = e.target.value; saveChoices(); render(); });
load();
setInterval(load, REFRESH_MS);
setInterval(() => data && ($('#fresh').textContent = `Last change ${ago(data.generated)} · ${data.games.length} ${(data.project && data.project.nounPlural) || 'items'}`), 30_000);
