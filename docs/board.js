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
  verdict: [['release', 'Release'], ['ship', 'Ship'], ['revise', 'Revise'], ['shelf', 'Shelf'], ['none', 'None']],
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
const VIEWS = [['needs', 'Needs you'], ['ready', 'Ready to try'], ['released', 'Released'], ['progress', 'In progress'], ['shelf', 'Shelf'], ['archived', 'Archived'], ['all', 'All'], ['queue', 'Queue'], ['checklist', 'Checklist'], ['models', 'Models']];
let view = localStorage.getItem('board.view');
if (!VIEWS.some(([v]) => v === view)) view = 'needs';
// A shared link may name the view: #range=120-140&view=checklist (P1UX03).
const CL = window.BoardChecklist;
const hashView = CL.viewFromHash(location.hash);
if (hashView && VIEWS.some(([v]) => v === hashView)) view = hashView;
let checks = null;
const cl = { chips: [], state: '', picked: new Set() };
let clShown = [], clAll = [];
// Needs you means: a human is the only thing the game is waiting for (the server sets needsYou only from board/asks.tsv).
// The view rules live in views.js (tested in node by test/views.test.js).
const { inProg, isReady, updatedSinceRelease, changeSummary, IN_VIEW, numLabel, findMatch, inRange, rangeFromHash, rangeToHash, copyList, byNumber, plain, namedGames } = window.BoardViews;
// Number range (P1BD07): lives in the URL hash (#range=120-140) so a link carries it.
let range = rangeFromHash(location.hash);
let visible = [];
let quota = null, requests = null;
let acts = null, reqs = null, costData = null;       // data/actions.json, data/requests.json, data/cost.json (P1UX06)
const sheet = { step: 1, action: null, ok: false };
const AC = window.BoardActions;
const qFilter = JSON.parse(localStorage.getItem('board.qfilter') || '{}');
const qf = { route: qFilter.route || [], state: qFilter.state || [] };
const qOpen = new Set();
// Why a game needs Chen: a new version to play, an open question, or a decision.
function whyKind(g) {
  const t = g.needsYou || '';
  if (/^new version/i.test(t)) return ['version', 'A new version to try'];
  if (t.includes('?')) return ['question', 'Has an open question'];
  return ['decision', 'A decision is waiting'];
}
const WHY_ORDER = { decision: 0, version: 1, question: 2 };
function whatToDo(g) {
  if (g.archived) return plain(g.archivedNote) || 'Made for one moment. Stays online. No more work.';
  if (g.needsYou) return plain(g.needsYou);
  if (view === 'ready' && isReady(g)) return 'Play it, then give a verdict: ship, revise or shelf.';
  return plain(g.priorityNote || g.line || '');
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

// ---------------------------------------------------------------- Models (P1WL00): which model ran what, and how it went
let models = null;
async function loadModels() {
  for (const url of ['data/models.json', 'https://raw.githubusercontent.com/ChenHsieh/agent-studio-board/main/docs/data/models.json']) {
    try { const r = await fetch(`${url}?t=${Date.now()}`, { cache: 'no-store' }); if (r.ok) { models = await r.json(); break; } } catch { /* next */ }
  }
  if (models && data) { renderViews(); if (view === 'models') renderModels(); }
}
const PASSED_WORD = { yes: 'passed', partial: 'partly', no: 'did not pass', '': 'not scored' };
function renderModels() {
  const box = $('#models-view');
  if (!models) { box.innerHTML = '<h2 id="m-h">Models</h2><p class="empty">Loading the model log…</p>'; return; }
  const rows = (models.scorecard || []).slice().sort((a, b) => b.count - a.count);
  const card = rows.map((r) => {
    const bits = [`${r.count} task${r.count === 1 ? '' : 's'}`, r.firstTimePass == null ? 'pass rate not scored' : `${r.firstTimePass}% passed first time`];
    if (r.retries) bits.push(`${r.retries} retr${r.retries === 1 ? 'y' : 'ies'}`);
    if (r.medianMinutes != null) bits.push(`median ${r.medianMinutes} min`);
    if (r.costPerPass != null) bits.push(`$${r.costPerPass.toFixed(2)} per pass`);
    if (r.guessed) bits.push(`${r.guessed} estimated`);
    const fails = (r.topFailures || []).length ? `<small>Most common misses: ${(r.topFailures || []).map(esc).join('; ')}</small>` : '';
    return `<li><b>${esc(r.executor)}</b> <span class="mrole">${esc(r.role)}</span>${r.flag ? ` <span class="mflag">${esc(r.flag)}</span>` : ''}<br>${esc(bits.join(' · '))}${fails}</li>`;
  }).join('');
  const last = (models.last || []).map((t) => `<li><time>${esc(t.date)}</time> ${t.number ? `<span class="num">#${esc(t.number)}</span> ` : ''}${esc(t.task)}<br><span class="mrole">${esc(t.executor)} · ${esc(t.role)} · ${esc(PASSED_WORD[t.passed] || t.passed)}</span>${t.note ? `<small>${esc(t.note)}</small>` : ''}</li>`).join('');
  box.innerHTML = `<h2 id="m-h">Models <small>who ran what, and how it went</small></h2>
  ${models.workflowNote ? `<p class="mnote"><b>What we changed:</b> ${esc(models.workflowNote)}</p>` : ''}
  <p class="ckey">'Passed first time' means the task's own checks passed without a retry. Rows marked estimated are read from the task's report, not from a check. Flags: under 60% says route that work elsewhere, over 85% says give it more.</p>
  <h3>Scorecard</h3><ul class="mlist">${card}</ul>
  <h3>Last 20 tasks</h3><ul class="mlist">${last}</ul>`;
}

async function loadChecks() {
  for (const url of ['data/checks.json', 'https://raw.githubusercontent.com/ChenHsieh/agent-studio-board/main/docs/data/checks.json']) {
    try { const r = await fetch(`${url}?t=${Date.now()}`, { cache: 'no-store' }); if (r.ok) { checks = await r.json(); break; } } catch { /* next */ }
  }
  if (checks && data) { renderViews(); if (view === 'checklist') renderChecklist(); }
}

// ---------------------------------------------------------------- Checklist by game (P1UX03)
function renderChecklist() {
  if (document.activeElement !== $('#cl-from')) $('#cl-from').value = range.from ?? '';
  if (document.activeElement !== $('#cl-to')) $('#cl-to').value = range.to ?? '';
  $('#cl-chips').innerHTML = CL.CHIPS.map(([id, label]) => `<button type="button" class="cchip" data-clchip="${id}" aria-pressed="${cl.chips.includes(id)}">${label}</button>`).join('');
  if (!checks) { $('#cl-table').innerHTML = '<p class="empty">Loading the checklist…</p>'; $('#cl-sub').textContent = ''; return; }
  clAll = CL.rows(checks, data.games);
  const order = ['building', 'revise', 'playable', 'in-review', 'ship', 'released', 'shelved', 'archived'];
  const states = [...new Set(clAll.map((r) => r.state).filter(Boolean))].sort((a, b) => order.indexOf(a) - order.indexOf(b));
  if (cl.state && !states.includes(cl.state)) cl.state = '';
  $('#cl-state').innerHTML = '<option value="">Any state</option>' + states.map((st) => `<option value="${esc(st)}"${st === cl.state ? ' selected' : ''}>${esc(CL.stateLabel(st))}</option>`).join('');
  clShown = CL.filter(clAll, { range, chips: cl.chips, state: cl.state, q: $('#q').value.trim() });
  const rangeText = range.from != null || range.to != null ? ` · numbers ${range.from ?? 'first'} to ${range.to ?? 'last'}` : '';
  $('#cl-sub').textContent = `${clShown.length} ${clShown.length === 1 ? 'game' : 'games'}${rangeText}`;
  const cnt = CL.counts(clShown);
  const allPicked = clShown.length > 0 && clShown.every((r) => cl.picked.has(r.slug));
  const head = `<tr><th scope="col" class="cgame"><label><input type="checkbox" id="cl-all" aria-label="Select every game shown"${allPicked ? ' checked' : ''}> Game</label></th>` +
    CL.COLUMNS.map(([k, label]) => `<th scope="col"><span>${label}</span><small>${cnt[k].no} no · ${cnt[k].notRun} not run</small></th>`).join('') + '</tr>';
  const body = clShown.map((r) => `<tr><th scope="row" class="cgame"><label><input type="checkbox" data-pick="${esc(r.slug)}"${cl.picked.has(r.slug) ? ' checked' : ''}><span class="n">#${r.number}</span> ${esc(r.title)}</label><small>${esc(CL.stateLabel(r.state))}</small></th>` +
    CL.COLUMNS.map(([k]) => { const c = r.checks[k]; return `<td class="cv-${esc(c.v)}"><button type="button" data-cell="${esc(r.slug)}|${k}">${CL.word(c.v)}</button></td>`; }).join('') + '</tr>').join('');
  $('#cl-table').innerHTML = clShown.length ? `<table class="ctable"><thead>${head}</thead><tbody>${body}</tbody></table>` : '<p class="empty">No game matches. Widen the range or turn a filter off.</p>';
  renderClBar();
}
function renderClBar() {
  const n = cl.picked.size;
  $('#cl-bar').hidden = !n;
  $('#cl-count').textContent = `${n} selected`;
}
function setRangeFrom(from, to) {
  range = window.BoardViews.normRange({ from, to });
  const h = rangeToHash(location.hash, range);
  history.replaceState(null, '', h || location.pathname + location.search);
  if (data) render();
}

async function loadJson(path) {
  for (const url of [path, `https://raw.githubusercontent.com/ChenHsieh/agent-studio-board/main/docs/${path}`]) {
    try { const r = await fetch(`${url}?t=${Date.now()}`, { cache: 'no-store' }); if (r.ok) return await r.json(); } catch { /* next */ }
  }
  return null;
}
async function loadActions() {
  const [a, r, c] = await Promise.all([loadJson('data/actions.json'), loadJson('data/requests.json'), loadJson('data/cost.json')]);
  acts = a; reqs = r; costData = c;
  if (view === 'queue') renderQueueView();
}

async function loadExtra() {
  loadChecks();
  loadActions();
  loadModels();
  Gauge.load().then((q) => { if (q) { quota = q; paintGauge(); if (view === 'queue') renderQueueView(); } });
  for (const url of ['data/queue.json', 'https://raw.githubusercontent.com/ChenHsieh/agent-studio-board/main/docs/data/queue.json']) {
    try { const r = await fetch(`${url}?t=${Date.now()}`, { cache: 'no-store' }); if (r.ok) { requests = await r.json(); break; } } catch { /* next */ }
  }
  // render outside the fetch loop: a render error (board data not loaded yet) must not fall through to the older remote copy
  if (requests) { if (view === 'queue') renderQueueView(); if (data) renderViews(); }
}
function paintGauge() { $('#gauge-head').innerHTML = Gauge.compactHtml(quota); }

const ROUTES = ['Codex', 'Claude', 'OpenRouter'];
const QSTATES = [['running', 'Running'], ['ready', 'Ready'], ['waiting', 'Waiting'], ['done', 'Done']];
function stateText(t) {
  if (t.state === 'running') return `running since ${ago(new Date(t.at * 1000).toISOString())}`;
  if (t.state === 'done') return `done ${ago(new Date(t.at * 1000).toISOString())}`;
  if (t.state === 'waiting') { const w = t.waitingOn || []; return `waiting on ${w[0] ? w[0].replace(/^[A-Za-z]*\d+[a-z0-9]*_/, '') : 'an earlier task'}${w.length > 1 ? ` +${w.length - 1}` : ''}`; }
  return 'ready';
}
function requestHtml(t) {
  const isOpen = qOpen.has(t.id);
  const share = t.route === 'Codex' && t.state !== 'done' ? `<span class="share">~${t.estPercentOfWeek}% of week</span>` : '';
  const meta = [['Task', t.id], ['Kind', t.kind], ['Size', t.size + (t.estMinutes ? `, about ${t.estMinutes} min` : '')], ['Priority', t.priority || 'none'],
    ['Age', `queued ${ago(new Date(t.created * 1000).toISOString())}`], ['After', (t.after || []).length ? t.after.join(', ') : 'nothing']];
  return `<li class="req${isOpen ? ' open' : ''}" data-rid="${esc(t.id)}"><button class="rrow" aria-expanded="${isOpen}">
    <span class="rtext">${esc(t.request)}</span>
    <span class="rline"><span class="rgame">${esc(t.game)}</span>${t.wasCodex ? '<span class="chip2 wascx">was Codex</span>' : ''}<span class="chip2">${esc(t.model)}</span><span class="chip2">${esc(t.effort)}</span><span class="rst ${esc(t.state)}">${esc(stateText(t))}</span>${share}</span></button>
    ${t.why ? `<p class="why rwhy"><b>Why this exists:</b> ${esc(t.why)}</p>` : ''}
    <dl class="rqmeta">${meta.map(([k, v]) => `<div><dt>${k}</dt><dd>${esc(v)}</dd></div>`).join('')}</dl></li>`;
}
// Codex out: Claude covers the highest-priority Codex tasks (planner plus overflow workers, max 3); Codex back: tasks handed back.
function overflowHtml(o) {
  if (!o) return '';
  if (o.codexOut) return `<div class="ovf" role="status"><b>Codex plan used up: Claude is covering the highest-priority tasks</b><span>${o.converted} ${o.converted === 1 ? 'task' : 'tasks'} moved to Claude · Claude workers ${o.claudeWorkers} of ${o.claudeWorkerCap} (the planner plus overflow workers)</span></div>`;
  if (o.handedBack && o.lastHandBack && Date.now() / 1000 - o.lastHandBack < 48 * 3600) return `<div class="ovf back" role="status"><b>Codex is back: ${o.lastHandBackN || o.handedBack} ${(o.lastHandBackN || o.handedBack) === 1 ? 'task' : 'tasks'} handed back</b></div>`;
  return '';
}
// OpenRouter lane, always shown (even when empty).
function orHtml(o) {
  if (!o) return '';
  const models = Object.entries(o.modelsQueued || {}).map(([m, n]) => `<span class="chip2">${esc(m)} × ${n}</span>`).join('');
  const spend = `about $${(o.spendTodayUsd || 0).toFixed(2)} today${o.runsTodayUnpriced ? ` (${o.runsTodayUnpriced} of ${o.runsToday} runs had no price recorded)` : ''}, estimate`;
  const empty = !o.queued && !o.running;
  const recent = (o.recent || []).map((t) => `<li><span class="ortext">${esc(t.request)}</span><span class="orline"><span class="chip2">${esc(t.model)}</span><span>done ${esc(ago(new Date(t.at * 1000).toISOString()))}</span></span></li>`).join('');
  return `<div class="gpanel orpanel"><h3>OpenRouter lane</h3>
    ${empty ? '<p class="gpace">Nothing queued: the lane is waiting for the planner</p>' : ''}
    <dl class="gdl ordl">
      <div><dt>Lanes</dt><dd>${o.lanesBusy} working</dd></div>
      <div><dt>Queued</dt><dd>${o.queued} (${o.ready} ready, ${o.waiting} waiting)</dd></div>
      <div><dt>Running</dt><dd>${o.running}</dd></div>
      <div><dt>Done</dt><dd>${o.done24h} in the last 24 h</dd></div>
      <div><dt>Models</dt><dd>${models || 'none queued'}</dd></div>
      <div><dt>Spend</dt><dd>${esc(spend)}</dd></div>
    </dl>
    ${recent ? `<h4 class="orh">Last ${(o.recent || []).length} finished</h4><ul class="orrecent">${recent}</ul>` : ''}</div>`;
}
// ---------------------------------------------------------------- Requests and the action sheet (P1UX06)
function titleOf(slug) { const g = data && data.games.find((x) => x.id === slug); return g ? `#${g.number} ${g.title}` : slug; }
function requestCardsHtml() {
  const list = ((reqs && reqs.requests) || []).slice().reverse();
  const items = list.map((r) => {
    const t = r.tasks || {}, total = (t.done || 0) + (t.running || 0) + (t.waiting || 0) + (t.stopped || 0);
    const w = (n) => total ? `${Math.round(100 * (n || 0) / total)}%` : '0%';
    const state = { new: 'sent, not yet read by the planner', queued: 'queued', 'needs-ok': 'waiting for your spend ok', refused: 'refused (only you can do this)', stopped: 'stopped', recorded: 'recorded', error: 'could not be read' }[r.status] || r.status;
    const games = (r.gameIds || []).map((g) => `<li>${esc(titleOf(g))}</li>`).join('');
    const live = ['queued'].includes(r.status) && ((t.waiting || 0) + (t.running || 0)) > 0;
    return `<li class="rcard" data-req="${esc(r.id)}"><h4>${esc(r.action)} <small>${esc(r.selector)}</small></h4>
      <p class="rqmeta">${r.games} ${r.games === 1 ? 'game' : 'games'} · ${esc(state)} · sent ${esc(ago(r.sent))}${r.pickedUp ? ` · picked up ${esc(ago(r.pickedUp))}` : ' · not picked up yet'}</p>
      ${total ? `<div class="rbar" role="img" aria-label="${esc(AC.barWords(t))}"><i class="q-done" style="width:${w(t.done)}"></i><i class="q-running" style="width:${w(t.running)}"></i><i class="q-queued" style="width:${w(t.waiting)}"></i></div><p class="rqmeta">${esc(AC.barWords(t))}</p>` : ''}
      <p class="rqmeta">Spent about $${(r.spentUsd || 0).toFixed(2)} of $${(r.estUsd || 0).toFixed(2)} estimated</p>
      <div class="rbtns"><button type="button" data-rtasks="${esc(r.id)}" aria-expanded="false">See the tasks</button>${live ? `<button type="button" data-copy="REQ|stop|${esc(r.id)}">Stop the rest</button>` : ''}</div>
      <ul class="rgames" hidden>${games || '<li>No games recorded yet.</li>'}</ul></li>`;
  }).join('');
  return `<h3 class="rgroup">Your requests <small>${list.length}</small></h3>` + (items ? `<ul class="rcards">${items}</ul>`
    : '<p class="empty">No requests yet. In the Checklist, tick games, choose an action and copy the line into the chat.</p>');
}
const SHEET_TEXT = { story: 'Words and a short row of strings', 'first-minute': 'The first 3 to 5 steps a new player meets', a11y: 'Big text, symbols with words, no colour-only cue',
  'release-checks': 'One sweep, no edits to any game', review: 'A stranger plays two games and gives ship, revise or shelf', release: 'Marks the game public-ready', archive: 'Stays online, no more work', shelve: 'Tried and not working', question: 'Answered from the files', stop: 'Use a request card instead' };
function openSheet() { if (!acts || !checks) return; sheet.step = 1; sheet.action = null; sheet.ok = false; renderSheet(); $('#sheet').hidden = false; document.body.classList.add('sheet-open'); const b = $('#sheet button'); if (b) b.focus(); }
function closeSheet() { $('#sheet').hidden = true; document.body.classList.remove('sheet-open'); const b = $('#cl-act'); if (b) b.focus(); }
function sheetCtx() {
  const running = new Set((data.games || []).filter((g) => (g.tasks || []).some((t) => t.state === 'running')).map((g) => g.id));
  return { running, held: new Set((data.playQueue || []).map((g) => g.id)) };
}
function renderSheet() {
  const el = $('#sheet'), picked = clAll.filter((r) => cl.picked.has(r.slug));
  const nums = AC.selectorText(picked.map((r) => r.number));
  const close = '<button type="button" class="sclose" data-sheet="close">Close</button>';
  if (sheet.step === 1) {
    const items = acts.actions.filter((a) => a.id !== 'stop').map((a) => `<li><button type="button" class="sact" data-sheet-action="${esc(a.id)}"><b>${esc(a.label)}</b><small>${esc(SHEET_TEXT[a.id] || '')}${a.who === 'chen' ? ' · only you can do this' : ''}</small></button></li>`).join('');
    el.innerHTML = `<div class="sinner"><div class="shead"><h2 id="sheet-h">Choose an action</h2>${close}</div><p class="smeta">${picked.length} ${picked.length === 1 ? 'game' : 'games'} selected: ${esc(nums)}</p><ul class="sacts">${items}</ul></div>`;
    return;
  }
  const a = acts.actions.find((x) => x.id === sheet.action), groups = AC.split(a, picked, sheetCtx());
  const est = AC.estimate(a, groups, { spendLineUsd: acts.spendLineUsd, spendLineCodexShare: acts.spendLineCodexShare });
  const rate = costData && costData.routes && costData.routes.Claude ? `Measured average: $${costData.routes.Claude.usdPerGoodTask.toFixed(2)} per finished Claude task (${esc(costData.label || 'estimate')}).` : '';
  const chenOnly = a.who === 'chen';
  const lists = AC.GROUPS.map(([k, label]) => groups[k].length ? `<h3>${label} <small>${groups[k].length}</small></h3><ul class="sgames">${groups[k].map((r) => `<li>#${r.number} ${esc(r.title)}</li>`).join('')}</ul>` : '').join('');
  const needTick = est.over && !sheet.ok;
  const line = AC.reqLine(a, picked.map((r) => r.number), est, sheet.ok, '');
  el.innerHTML = `<div class="sinner"><div class="shead"><h2 id="sheet-h">${esc(a.label)}</h2>${close}</div>
    <p class="smeta">${picked.length} ${picked.length === 1 ? 'game' : 'games'}: ${esc(nums)}</p>
    <p class="splan"><b>${est.tasks}</b> ${est.tasks === 1 ? 'task' : 'tasks'} would be queued.${chenOnly ? ' Only you can do this: the planner refuses it from anyone else.' : ''}</p>
    ${lists}
    <p class="sest">Estimate: about <b>$${est.usd.toFixed(0)}</b> of Claude${est.codexShare ? ` and ${(est.codexShare * 100).toFixed(0)}% of the Codex week` : ''}. ${esc(rate)}</p>
    ${est.over ? `<label class="stick"><input type="checkbox" id="sheet-ok"${sheet.ok ? ' checked' : ''}> This is over the spend line ($${acts.spendLineUsd}). I agree to the cost.</label>` : ''}
    <div class="sbtns"><button type="button" data-sheet="back">Back</button><button type="button" id="sheet-copy" data-sheet="copy" data-line="${esc(line)}"${needTick ? ' disabled' : ''}>Copy as text for the chat</button></div>
    <p class="smeta">Nothing is sent from this page. Paste the copied line into the chat.</p><pre class="sline">${esc(line)}</pre></div>`;
}

function renderQueueView() {
  const el = $('#queue-view');
  const all = (requests && requests.tasks) || [];
  const shown = all.filter((t) => (!qf.route.length || qf.route.includes(t.route)) && (!qf.state.length || qf.state.includes(t.state)));
  const chips = (group, list) => list.map(([v, l]) => `<button class="chip qchip" data-qf="${group}" data-value="${v}" aria-pressed="${qf[group].includes(v)}">${l}</button>`).join('');
  const groups = ROUTES.map((r) => {
    const rows = shown.filter((t) => t.route === r);
    if (r === 'Claude') rows.sort((a, b) => (b.wasCodex ? 1 : 0) - (a.wasCodex ? 1 : 0));
    if (!rows.length) return '';
    return `<h3 class="rgroup">${r} <small>${rows.length}</small></h3><ul class="reqs">${rows.map(requestHtml).join('')}</ul>`;
  }).join('');
  el.innerHTML = `${requestCardsHtml()}${overflowHtml(requests && requests.overflow)}<div class="gfull">${Gauge.fullHtml(quota)}</div>${orHtml(requests && requests.openrouter)}
    <div class="qfilters"><div class="qfg" aria-label="Route">${chips('route', ROUTES.map((r) => [r, r]))}</div><div class="qfg" aria-label="State">${chips('state', QSTATES)}</div></div>
    <p class="qcount">${shown.length} of ${all.length} requests${requests ? ` · updated ${ago(new Date(requests.generated * 1000).toISOString())}` : ''}</p>
    ${requests ? (groups || '<p class="empty">Nothing matches.</p>') : '<p class="empty">Loading the queue…</p>'}`;
}

async function load() {
  loadExtra();
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
  const q = data.queue || {};
  const paused = !!q.codexPaused;
  const codexIdle = paused ? 0 : (data.codexLanes || 0) - lanes.filter((l) => l.worker === 'Codex').length;
  for (let i = 0; i < codexIdle; i++) rows.push('<li class="lane idle"><span class="who">Codex</span><span class="what">Idle, waiting for a task</span></li>');
  // The lane bar: one pip per Claude lane (cap from the data), filled while a Claude agent works. Codex is not drawn while paused.
  const cap = (q.laneCap && q.laneCap.Claude) || 4;
  const busy = lanes.filter((l) => l.worker === 'Claude').length;
  const pips = Array.from({ length: cap }, (_, i) => `<i class="${i < busy ? 'on' : ''}"></i>`).join('');
  const bar = `<li class="lane-bar" aria-label="Claude lanes: ${busy} of ${cap} working${paused ? '. Codex paused (quota)' : ''}"><span class="pips" aria-hidden="true">${pips}</span><span>Claude ${busy} of ${cap} lanes · ${paused ? 'Codex paused (quota)' : `Codex ${data.codexLanes || 0} ${data.codexLanes === 1 ? 'lane' : 'lanes'}`}</span></li>`;
  return bar + (rows.join('') || '<li class="lane idle"><span class="who">—</span><span class="what">No agent is working right now.</span></li>');
}

function queueHtml() {
  const rows = (data.queue && data.queue.workers) || {};
  const paused = !!(data.queue && data.queue.codexPaused);
  return ['Claude', 'Codex'].map((worker) => {
    const n = rows[worker] || {};
    const total = (n.queued || 0) + (n.running || 0) + (n.doneToday || 0);
    const width = (part) => total ? `${(part || 0) / total * 100}%` : '0%';
    const off = worker === 'Codex' && paused;
    const label = `${worker}${off ? ' (paused, quota)' : ''}: ${n.queued || 0} queued, ${n.running || 0} running, ${n.doneToday || 0} done today`;
    return `<div class="queue-row${off ? ' paused' : ''}"><span class="queue-worker">${worker}</span><div class="queue-track" role="img" aria-label="${esc(label)}"><i class="q-queued" style="width:${width(n.queued)}"></i><i class="q-running" style="width:${width(n.running)}"></i><i class="q-done" style="width:${width(n.doneToday)}"></i></div><span class="queue-count">${off ? 'Paused (quota) · ' : ''}Q ${n.queued || 0} · R ${n.running || 0} · D ${n.doneToday || 0}</span></div>`;
  }).join('');
}

function tallyHtml() {
  const n = {};
  for (const g of data.games) { if (g.archived) { n.archived = (n.archived || 0) + 1; continue; } n[g.stage] = (n[g.stage] || 0) + 1; if (g.released) n.released = (n.released || 0) + 1; }
  const parts = (n.released ? [`<span><b>${n.released}</b> released</span>`] : []).concat(['building', 'review', 'queued', 'planning', 'shelf', 'live'].filter((s) => n[s]).map((s) => `<span><b>${n[s]}</b> ${s}</span>`));
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

const COST_TIP = 'Estimate, not a bill. Codex runs are tokens at the board rate, Claude runs are estimated per run, and earlier rounds are estimated per round.';
function glanceHtml(g) {
  const next = plain(g.nextTask) ? `Next: ${esc(plain(g.nextTask))}` : 'Nothing queued';
  const cost = g.costTotalUsd != null ? g.costTotalUsd : (g.cost && g.cost.totalUsdEst) || 0;
  const lc = g.latestChange;
  const said = lc && plain(changeSummary(lc.text)); // a commit subject that is only a task code says nothing: give the time alone
  const upd = said ? `Updated ${esc(ago(lc.at))}: ${esc(said)}` : (lc && lc.at ? `Updated ${esc(ago(lc.at))}` : (g.lastChange ? `Updated ${esc(ago(g.lastChange))}` : ''));
  return `<span class="glance"><span class="g-next">${next}</span><span class="g-cost" title="${esc(COST_TIP)}" aria-label="est. $${Math.round(cost)}. ${esc(COST_TIP)}">est. $${Math.round(cost)} <i aria-hidden="true">i</i></span>${upd ? `<span class="g-upd">${upd}</span>` : ''}</span>`;
}

function promoHtml(g) {
  const f = g.promo && g.promo.files;
  if (!f || !Object.keys(f).length) return '';
  const items = [['first', 'First screen', 'first'], ['play', 'In play', 'play'], ['card', 'Share card', 'card']].filter(([k]) => f[k]);
  return `<h3>Promo images</h3><div class="promo" role="list">${items.map(([k, label, cls]) => `<figure class="pi ${cls}" role="listitem">
    <img src="${esc(f[k])}" alt="${esc(g.title)}: ${esc(label.toLowerCase())}${g.promo.caption && k === 'card' ? ', ' + esc(g.promo.caption) : ''}" loading="lazy" decoding="async">
    <figcaption><button type="button" class="pbtn" data-share="${esc(f[k])}" data-title="${esc(g.title)}" data-url="${esc(g.url)}" data-name="${esc(g.id)}-${k}.jpg">Share</button><span class="plabel">${esc(label)}</span></figcaption></figure>`).join('')}</div>`;
}

// Released games say so in words: public-ready, still open to refinement. The working stage stays in the data.
function stageBadge(g) {
  if (g.archived) return '<span class="st archived">Archived</span>';
  if (!g.released) return `<span class="st ${esc(g.stage)}">${esc(g.stage)}</span>`;
  return `<span class="st released">${inProg(g) ? 'Released, refining' : 'Released'}</span>`;
}

// Released view: a released game that changed after its release day says so, with the latest change when there is one.
function sinceReleaseHtml(g) {
  const d = view === 'released' && updatedSinceRelease(g);
  if (!d) return '';
  const lc = plain(changeSummary(g.latestChange && g.latestChange.text));
  const when = new Date(d + 'T12:00:00').toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
  return `<span class="since-release"><b>Updated since release</b> ${esc(when)}${lc ? ': ' + esc(lc) : ''}</span>`;
}

// Why this exists (board/why_exists.tsv, Chen 2026-10-24): what sparked the game, what it tries to say, why it is worth
// playing, with the most creditable source when there is one. Open where Chen is about to play (Ready to try, Needs you)
// and on an opened card; one tap away elsewhere.
function whyExistsHtml(g) {
  if (!g.whyExists) return '';
  const isOpen = view === 'ready' || view === 'needs' || open.has(g.id);
  const s = g.whySource || {};
  const src = s.url ? `<span class="why-src">Source: <a href="${esc(s.url)}" target="_blank" rel="noopener">${esc(s.name || s.url)}</a></span>`
    : s.name ? `<span class="why-src">Source: ${esc(s.name)}</span>` : '';
  return `<details class="expect why-exists"${isOpen ? ' open' : ''}><summary>Why this exists</summary><p>${esc(g.whyExists)}${src ? ' ' + src : ''}</p></details>`;
}

// One tap to the live page of the card's game and of every other game its question names (Needs you, Ready to try).
function openGamesHtml(g) {
  if (view !== 'needs' && view !== 'ready') return '';
  const games = namedGames(g, data.games);
  return `<p class="open-games">${games.map((o) => `<a class="open-game" href="${esc(o.url)}" target="_blank" rel="noopener" aria-label="Open game ${esc(numLabel(o) ? numLabel(o) + ' ' : '')}${esc(o.title)}"><b>Open game</b><span>${esc((numLabel(o) ? numLabel(o) + ' ' : '') + o.title)}</span></a>`).join('')}</p>`;
}

function gameHtml(g) {
  const img = g.image ? `<img class="thumb" src="${esc(g.image)}" alt="" loading="lazy">` : `<span class="thumb blank" aria-hidden="true">${esc(g.title[0])}</span>`;
  const repoUrl = `https://github.com/ChenHsieh/${encodeURIComponent(g.repo || g.id)}`;
  const plans = (g.tasks || []).filter((t) => t.state !== 'done' && t.plan);
  const said = plans.map((t) => `<p class="said">${esc(t.plan)}<small>${esc(t.worker)} · ${esc(t.state === 'running' ? 'building now' : t.state)}</small></p>`).join('');
  const tasks = (g.tasks || []).map((t) => {
    const when = t.state === 'done' ? `done ${ago(t.done)}${t.reviewed ? ', reviewed' : ''}` : t.state === 'running' ? `running since ${ago(t.since)}` : t.state;
    const commit = t.commit && plain(t.commit.subject) ? `<span class="tag">last commit ${ago(t.commit.at)}: “${esc(plain(t.commit.subject))}”</span>` : '';
    const extra = t.state === 'done' && plain(t.result) ? `<span class="tag">${esc(plain(t.result))}</span>` : commit;
    return `<li><span class="tag">${esc(t.worker)} · ${esc(when)}</span><br>${esc(plain(t.title) || "Task")}${extra ? '<br>' + extra : ''}</li>`;
  }).join('');
  const hist = (g.history || []).map((h) => `<li><time>${esc(day(h.at))}</time>${h.ok ? '' : '<span class="no">not done: </span>'}${esc(plain(h.note))}${h.source ? `<small class="history-source">${esc(h.source)}</small>` : ''}</li>`).join('');
  return `<li class="game${open.has(g.id) ? ' open' : ''}" data-id="${esc(g.id)}">
  <button class="row" aria-expanded="${open.has(g.id)}">${img}<span class="name">${numLabel(g) ? `<span class="num">${esc(numLabel(g))}</span> ` : ''}${esc(g.title)}</span>
    <span class="meta">${stageBadge(g)}${g.verdict && !g.released && !g.archived ? `<span class="vd ${esc(g.verdict.verdict)}">${esc(g.verdict.verdict)}</span>` : ''}<span class="p">${g.archived ? '' : esc(g.priority || '')}</span></span>
    <span class="line">${g.needsYou ? '<b class="ask">To do:</b> ' : ''}${esc(whatToDo(g))}</span>${sinceReleaseHtml(g)}${glanceHtml(g)}</button>
  ${whyExistsHtml(g)}
  ${openGamesHtml(g)}
  <a class="play-link" href="${esc(g.url)}" target="_blank" rel="noopener" aria-label="Play ${esc(g.title)}">Play</a>
  <div class="detail">
    ${g.why ? `<p class="why"><b>In one line:</b> ${esc(plain(g.why))}</p>` : ''}
    <p class="detail-links"><a href="${esc(g.url)}" target="_blank" rel="noopener">Play</a><a href="${esc(repoUrl)}" target="_blank" rel="noopener">Repo</a><button type="button" class="pbtn" data-copy="${esc(g.url)}">Copy link</button></p>
    ${promoHtml(g)}
    ${g.line ? `<p>${esc(plain(g.line))}</p>` : ''}
    <p class="cost">${costLine(g.cost)}<br><small class="muted">${esc(COST_TIP)}</small></p>
    ${g.needsYou ? `<p class="said">${esc(plain(g.needsYou))}<small>Waiting for a human</small></p>` : ''}
    ${g.archived ? `<p class="said archived-note"><b>Archived${g.archivedOn ? ' on ' + esc(g.archivedOn) : ''}.</b> ${esc(plain(g.archivedNote) || 'Made for one moment. Stays online. No more work.')}</p>` : ''}
    ${g.released ? `<p class="said released-note"><b>Released${g.releasedOn ? ' on ' + esc(g.releasedOn) : ''}.</b> Ready for the public${inProg(g) ? '; being refined now' : '; can still be refined'}.${g.releasedNote ? ' ' + esc(g.releasedNote) : ''}<small>Stage underneath: ${esc(g.stage)}</small></p>` : ''}
    ${g.verdict ? `<p class="said">${esc(g.verdict.verdict)}: ${esc(g.verdict.note)}<small>Verdict, ${esc(g.verdict.date)}</small></p>` : ''}
    ${g.shelfNote ? `<p class="said">${esc(plain(g.shelfNote))}<small>Why it is on the shelf</small></p>` : ''}
    ${said ? '<h3>Plan</h3>' + said : ''}
    <h3>Task status</h3><p class="task-summary">${taskCounts(g)}</p>
    ${tasks ? '<h3>Tasks</h3><ul class="tasks">' + tasks + '</ul>' : ''}
    ${hist ? '<h3>Changelog</h3><ul class="hist">' + hist + '</ul>' : ''}
  </div></li>`;
}

function renderViews() {
  const count = (v) => v === 'models' ? ((models && models.scorecard) || []).length : v === 'checklist' ? (checks ? checks.games.length : data.games.length) : v === 'queue' ? ((requests && requests.tasks) || []).filter((t) => t.state !== 'done').length : data.games.filter(IN_VIEW[v]).length + (v === 'needs' ? (data.systemNeeds || []).length : 0);
  $('#views').innerHTML = VIEWS.map(([v, label]) => `<button class="view" role="tab" data-view="${v}" aria-selected="${v === view}">${label} <b>${count(v)}</b></button>`).join('');
}

function renderChips() {
  for (const [group, choices] of Object.entries(FILTERS)) {
    document.querySelector(`[data-chips="${group}"]`).innerHTML = choices.map(([value, label]) => `<button class="chip" data-filter="${group}" data-value="${value}" aria-pressed="${filters[group].includes(value)}">${label}</button>`).join('');
  }
  const count = Object.values(filters).reduce((n, values) => n + values.length, 0) + (range.from != null || range.to != null ? 1 : 0);
  if (document.activeElement !== $('#range-from')) $('#range-from').value = range.from ?? '';
  if (document.activeElement !== $('#range-to')) $('#range-to').value = range.to ?? '';
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
  if (sort === 'number') return byNumber(a, b);
  if (sort === 'released') return (b.released ? 1 : 0) - (a.released ? 1 : 0) || (b.releasedOn || '').localeCompare(a.releasedOn || '') || (b.lastChange || '').localeCompare(a.lastChange || '');
  if (sort === 'priority') return (a.priority || 'P9').localeCompare(b.priority || 'P9') || (b.lastChange || '').localeCompare(a.lastChange || '');
  if (sort === 'cost') return (b.cost.totalUsdEst || 0) - (a.cost.totalUsdEst || 0) || (b.lastChange || '').localeCompare(a.lastChange || '');
  return (b.lastChange || '').localeCompare(a.lastChange || '') || STAGE_ORDER[a.stage] - STAGE_ORDER[b.stage];
}

function render() {
  const p = data.project || {};
  $('#project').textContent = p.name || '';
  document.title = `Studio board · ${p.name || ''}`;
  const playCount = (data.playQueue || []).length;
  $('#play-queue-count').textContent = playCount;
  $('#play-queue-link').hidden = !playCount;
  $('#play-queue-separator').hidden = !playCount;
  const fresh = $('#fresh');
  fresh.textContent = `Last change ${ago(data.generated)} · ${data.games.length} ${(data.project && data.project.nounPlural) || 'items'}`;
  fresh.classList.remove('stale');
  $('#queue').innerHTML = queueHtml();
  const queue = data.queue || {};
  $('#queue-eta').textContent = queue.estimateMinutes ? `Est. finish ${day(queue.estimatedFinish)}` : 'Queue clear';
  const ops = data.ops || {}, notes = (ops.notes || []).filter((x) => typeof x === 'string');
  const info = (ops.info || []).filter((x) => typeof x === 'string');
  const n = ops.count || 0;
  $('#ops').hidden = !(n || info.length);
  $('#ops').classList.toggle('quiet', !n);
  if (n || info.length) {
    $('#ops-sum').textContent = (n ? `Ops: ${n} ${n === 1 ? 'warning' : 'warnings'}` : 'Ops: all clear') + info.map((x) => ` · ${x}`).join('');
    $('#ops-list').innerHTML = info.map((x) => `<li class="info">${esc(x)}</li>`).join('') + notes.map((x) => `<li>${esc(x)}</li>`).join('') + (n > notes.length ? `<li>and ${n - notes.length} more</li>` : '');
  }
  $('#lanes').innerHTML = lanesHtml();
  $('#tally').innerHTML = tallyHtml();
  $('#sort').value = sort;
  renderChips();
  const q = $('#q').value.trim().toLowerCase();
  renderViews();
  document.body.classList.toggle('qmode', view === 'queue');
  $('#queue-view').hidden = view !== 'queue';
  if (view === 'queue') renderQueueView();
  document.body.classList.toggle('mmode', view === 'models');
  $('#models-view').hidden = view !== 'models';
  if (view === 'models') renderModels();
  document.body.classList.toggle('cmode', view === 'checklist');
  $('#checklist-view').hidden = view !== 'checklist';
  if (view === 'checklist') renderChecklist();
  paintGauge();
  const list = data.games.filter((g) => findMatch(g, q) && inRange(g, range) && IN_VIEW[view](g) && matches(g)).sort(compare);
  visible = list;
  $('#copy-list').disabled = !list.length;
  let html = '', lastGroup = '';
  // System needs: what the pipeline itself is waiting on from a human (quota, a login, a stuck build), one line each.
  if (view === 'needs' && (data.systemNeeds || []).length) {
    html += '<li class="prio-h" role="presentation">The studio needs</li>' + data.systemNeeds.map((t) => `<li class="sys-need"><b class="ask">System needs:</b> ${esc(String(t).replace(/^System needs:\s*/, ''))}</li>`).join('');
  }
  if (view === 'archived') html += '<li class="view-note" role="presentation">Made for one moment. Stays online. No more work.</li>';
  for (const g of list) {
    if (view === 'needs') { const [key, label] = whyKind(g); if (key !== lastGroup) { html += `<li class="prio-h" role="presentation">${label}</li>`; lastGroup = key; } }
    html += gameHtml(g);
  }
  const emptyText = { needs: 'Nothing is waiting for you. Try “Ready to try”.', ready: 'No new version is waiting to be tried.', progress: 'Nothing is queued or running.', shelf: 'The shelf is empty.', archived: 'Nothing is archived.', released: 'No game has been released yet.', all: '' }[view];
  $('#games').innerHTML = html || `<li class="empty">${emptyText || 'Nothing matches.'}</li>`;
}

async function sharePromo(btn) {
  const { share, title, url, name } = btn.dataset; const label = btn.textContent;
  const download = (blob) => { const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = name; document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 4000); };
  try {
    const blob = await (await fetch(share)).blob();
    const file = new File([blob], name, { type: blob.type || 'image/jpeg' });
    if (navigator.canShare && navigator.canShare({ files: [file] })) { await navigator.share({ files: [file], title, url }); }
    else { download(blob); btn.textContent = 'Saved'; setTimeout(() => (btn.textContent = label), 1500); }
  } catch (err) { if (err && err.name !== 'AbortError') { btn.textContent = 'Could not share'; setTimeout(() => (btn.textContent = label), 1500); } }
}
document.addEventListener('click', (e) => {
  const sh = e.target.closest('[data-share]');
  if (sh) { sharePromo(sh); return; }
  const cp = e.target.closest('[data-copy]');
  if (cp) {
    const label = cp.textContent; const done = () => { cp.textContent = 'Copied'; setTimeout(() => (cp.textContent = label), 1500); };
    (navigator.clipboard ? navigator.clipboard.writeText(cp.dataset.copy) : Promise.reject()).then(done, () => { const t = document.createElement('textarea'); t.value = cp.dataset.copy; document.body.appendChild(t); t.select(); try { document.execCommand('copy'); done(); } catch {} t.remove(); });
    return;
  }
  const qc = e.target.closest('[data-qf]');
  if (qc) { const { qf: g, value } = qc.dataset; qf[g] = qf[g].includes(value) ? qf[g].filter((v) => v !== value) : [...qf[g], value]; localStorage.setItem('board.qfilter', JSON.stringify(qf)); renderQueueView(); return; }
  const rr = e.target.closest('.rrow');
  if (rr) { const id = rr.parentElement.dataset.rid; qOpen.has(id) ? qOpen.delete(id) : qOpen.add(id); rr.parentElement.classList.toggle('open'); rr.setAttribute('aria-expanded', String(qOpen.has(id))); return; }
  if (e.target.closest('#cl-act')) { openSheet(); return; }
  const sh2 = e.target.closest('[data-sheet]');
  if (sh2) {
    const k = sh2.dataset.sheet;
    if (k === 'close') closeSheet(); else if (k === 'back') { sheet.step = 1; renderSheet(); }
    else if (k === 'copy') {
      const line = sh2.dataset.line, done = () => { sh2.textContent = 'Copied'; setTimeout(() => (sh2.textContent = 'Copy as text for the chat'), 1500); };
      (navigator.clipboard ? navigator.clipboard.writeText(line) : Promise.reject()).then(done, () => { const t = document.createElement('textarea'); t.value = line; document.body.appendChild(t); t.select(); try { document.execCommand('copy'); done(); } catch {} t.remove(); });
    }
    return;
  }
  const sa = e.target.closest('[data-sheet-action]');
  if (sa) { sheet.action = sa.dataset.sheetAction; sheet.step = 2; sheet.ok = false; renderSheet(); const b = $('#sheet .sclose'); if (b) b.focus(); return; }
  const rt = e.target.closest('[data-rtasks]');
  if (rt) { const ul = rt.closest('.rcard').querySelector('.rgames'); ul.hidden = !ul.hidden; rt.setAttribute('aria-expanded', String(!ul.hidden)); return; }
  const tab = e.target.closest('[data-view]');
  if (tab && data) { view = tab.dataset.view; saveChoices(); const h = CL.viewToHash(location.hash, view === 'checklist' ? 'checklist' : null); history.replaceState(null, '', h || location.pathname + location.search); render(); return; }
  const cc = e.target.closest('[data-clchip]');
  if (cc) { const id = cc.dataset.clchip; cl.chips = cl.chips.includes(id) ? cl.chips.filter((x) => x !== id) : [...cl.chips, id]; renderChecklist(); return; }
  const cell = e.target.closest('[data-cell]');
  if (cell) {
    const [slug, k] = cell.dataset.cell.split('|'); const r = clAll.find((x) => x.slug === slug); if (!r) return;
    const c = r.checks[k], label = (CL.COLUMNS.find(([key]) => key === k) || [k, k])[1];
    const note = $('#cl-note'); note.hidden = false;
    note.textContent = `#${r.number} ${r.title}, ${label}: ${CL.word(c.v)}. ${c.source ? `From ${c.source}${c.at ? `, ${c.at}` : ''}.` : 'Nobody has checked this yet.'}`;
    return;
  }
  if (e.target.closest('#cl-copy')) {
    const b = $('#cl-copy'), picked = clAll.filter((r) => cl.picked.has(r.slug)), text = CL.copyLines(picked);
    const done = () => { b.textContent = `Copied ${picked.length}`; setTimeout(() => (b.textContent = 'Copy list'), 1500); };
    (navigator.clipboard ? navigator.clipboard.writeText(text) : Promise.reject()).then(done, () => { const t = document.createElement('textarea'); t.value = text; document.body.appendChild(t); t.select(); try { document.execCommand('copy'); done(); } catch {} t.remove(); });
    return;
  }
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
    const wx = row.parentElement.querySelector('details.why-exists');
    if (wx && open.has(id)) wx.open = true;
  }
});
document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && !$('#sheet').hidden) closeSheet(); });
$('#q').addEventListener('input', () => data && render());
document.addEventListener('change', (e) => {
  const pick = e.target.closest('[data-pick]');
  if (pick) { pick.checked ? cl.picked.add(pick.dataset.pick) : cl.picked.delete(pick.dataset.pick); renderClBar(); const all = $('#cl-all'); if (all) all.checked = clShown.length > 0 && clShown.every((r) => cl.picked.has(r.slug)); return; }
  if (e.target.id === 'cl-all') { for (const r of clShown) e.target.checked ? cl.picked.add(r.slug) : cl.picked.delete(r.slug); renderChecklist(); return; }
  if (e.target.id === 'cl-state') { cl.state = e.target.value; renderChecklist(); }
  if (e.target.id === 'sheet-ok') { sheet.ok = e.target.checked; renderSheet(); const b = $('#sheet-ok'); if (b) b.focus(); }
});
$('#cl-from').addEventListener('input', () => setRangeFrom($('#cl-from').value, $('#cl-to').value));
$('#cl-to').addEventListener('input', () => setRangeFrom($('#cl-from').value, $('#cl-to').value));
function setRange() {
  range = { from: $('#range-from').value, to: $('#range-to').value };
  range = window.BoardViews.normRange(range);
  const h = rangeToHash(location.hash, range);
  history.replaceState(null, '', h || location.pathname + location.search);
  if (data) render();
}
$('#range-from').addEventListener('input', setRange);
$('#range-to').addEventListener('input', setRange);
$('#range-clear').addEventListener('click', () => { $('#range-from').value = ''; $('#range-to').value = ''; setRange(); });
window.addEventListener('hashchange', () => { range = rangeFromHash(location.hash); const hv = CL.viewFromHash(location.hash); if (hv && VIEWS.some(([v]) => v === hv)) view = hv; if (data) render(); });
$('#copy-list').addEventListener('click', () => {
  const b = $('#copy-list'), text = copyList(visible), label = 'Copy list';
  const done = () => { b.textContent = `Copied ${visible.length}`; setTimeout(() => (b.textContent = label), 1500); };
  (navigator.clipboard ? navigator.clipboard.writeText(text) : Promise.reject()).then(done, () => { const t = document.createElement('textarea'); t.value = text; document.body.appendChild(t); t.select(); try { document.execCommand('copy'); done(); } catch {} t.remove(); });
});
$('#sort').addEventListener('change', (e) => { sort = e.target.value; saveChoices(); render(); });
load();
setInterval(load, REFRESH_MS);
setInterval(() => data && ($('#fresh').textContent = `Last change ${ago(data.generated)} · ${data.games.length} ${(data.project && data.project.nounPlural) || 'items'}`), 30_000);
