// Daily brief: the board's first screen (design BOARD_UX_20261023.md section 4). Reads data/brief.json, which
// board/brief.py writes on the build machine. Decide today, What changed (since the last look on this device),
// Stuck, Spend so far. Pure functions are exported for node (test/brief.test.js); the page part runs in the browser.
(function (root) {
  'use strict';
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const TASK_ID = /\bP\d[A-Za-z]+\d+[a-z]?_[\w-]*/g;
  const clean = (s) => String(s == null ? '' : s).replace(TASK_ID, '').replace(/\s{2,}/g, ' ').trim();
  const DAY = 86_400_000;
  const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
  const WEEK = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
  const longDay = (d) => `${WEEK[d.getDay()]} ${d.getDate()} ${MONTHS[d.getMonth()]}`;
  const shortDay = (iso) => { const d = new Date(`${iso}T12:00:00`); return Number.isNaN(+d) ? iso : `${WEEK[d.getDay()].slice(0, 3)} ${d.getDate()} ${MONTHS[d.getMonth()].slice(0, 3)}`; };
  const isoDay = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  // "#127 Nobody Looking" -> number in its own span, as on the rest of the board
  const nameHtml = (n) => { const m = /^#(\d+)\s+(.*)$/.exec(String(n || '')); return m ? `<span class="n">#${m[1]}</span>${esc(m[2])}` : esc(n); };

  // The last look on this device: stored when the page is left, read at the next visit. First visit: the last 3 days.
  function sinceFor(stored, now) {
    const t = Date.parse(stored || '');
    if (!Number.isNaN(t) && t < now) return { at: new Date(t), first: false };
    return { at: new Date(now - 3 * DAY), first: true };
  }

  const GROUPS = [['released', (n) => `You released ${n} ${n === 1 ? 'game' : 'games'}`], ['ship', (n) => `${n} ${n === 1 ? 'game' : 'games'} rated ship`],
    ['revise', (n) => `You sent ${n} ${n === 1 ? 'game' : 'games'} back to refining`], ['new', (n) => `${n} new ${n === 1 ? 'game' : 'games'} started building`],
    ['archived', (n) => `${n} ${n === 1 ? 'game' : 'games'} archived`], ['shelf', (n) => `${n} ${n === 1 ? 'game' : 'games'} shelved`],
    ['try', (n) => `${n} ${n === 1 ? 'game' : 'games'} marked to try`],
    ['regressed', (n) => n === 1 ? '1 game no longer passes a release check it passed before' : `${n} games no longer pass a release check they passed before`],
    ['default', (n) => `${n} cheap ${n === 1 ? 'decision' : 'decisions'} went ahead with the pick`]];
  // Events on or after the day of the last look, grouped in a fixed order. Regressions are a standing condition: always shown.
  function groupEvents(events, sinceDay) {
    const xs = (events || []).filter((e) => e.kind === 'regressed' || (e.at || '') >= sinceDay);
    return GROUPS.map(([k, label]) => {
      const es = xs.filter((e) => e.kind === k);
      if (!es.length) return null;
      const names = es.map((e) => e.gameName || e.game);
      return { kind: k, count: es.length, label: label(es.length), names: names.slice(0, 3), more: Math.max(0, names.length - 3) };
    }).filter(Boolean);
  }

  const CHOICES = { cheap: [['yes', 'Yes, my pick'], ['not now', 'Not now'], ['why', 'Ask why']], 'only-you': [['I will do it', 'I will do it'], ['not now', 'Not now'], ['why', 'Ask why']] };
  function answerLine(d, choice) { return `ask|${d.game}|${choice}`; }
  function holdsUp(d) {
    const parts = [];
    if (d.blocksGames) parts.push(`${d.blocksGames} ${d.blocksGames === 1 ? 'game' : 'games'}`);
    if (d.blocksTasks) parts.push(`${d.blocksTasks} ${d.blocksTasks === 1 ? 'task' : 'tasks'}`);
    return parts.length ? `Holds up ${parts.join(' and ')}` : 'Holds nothing up yet';
  }
  function decisionHtml(d) {
    const meta = [holdsUp(d)];
    if (d.daysWaiting != null) meta.push(d.daysWaiting === 0 ? 'new today' : `waiting ${d.daysWaiting} ${d.daysWaiting === 1 ? 'day' : 'days'}`);
    meta.push(d.kind === 'only-you' ? 'only you can do this' : 'no cost to you');
    const pick = clean(d.pick);
    const after = d.goesAheadOn ? `<p class="bdefault"><b>If you say nothing</b>Goes ahead on ${esc(shortDay(d.goesAheadOn))}.</p>`
      : `<p class="bdefault"><b>If you say nothing</b>${esc(clean(d.ifNothing) || 'It waits for you.')}</p>`;
    const btns = (CHOICES[d.kind] || CHOICES.cheap).map(([c, label], i) => `<button type="button" class="${i === 0 ? 'go' : ''}" data-copy="${esc(answerLine(d, c))}" aria-label="${esc(label)}: copy the answer line for the chat">${esc(label)}</button>`).join('');
    return `<li class="bdec"><span class="k">${esc(d.rank)}</span><div class="bbody"><p class="lead">${nameHtml(d.gameName)}: ${esc(clean(d.question))}</p>`
      + `<p class="bmeta">${esc(meta.join(' · '))}</p>${pick ? `<p class="bdefault"><b>My pick</b>${esc(pick)}</p>` : ''}${after}`
      + `<div class="bbtns">${btns}</div></div></li>`;
  }
  function stuckHtml(s) {
    if (s.kind === 'over-cap') return `<li>${esc(s.lane)}: <b>${esc(s.count)}</b> games, limit ${esc(s.cap)}<span class="why">New work waits until some of these move on. Nothing to do unless you want to shelve some.</span></li>`;
    const flag = s.days ? `<span class="flag">${esc(s.days)} ${s.days === 1 ? 'day' : 'days'}</span>` : '';
    return `<li>${nameHtml(s.gameName || 'Studio tools')} ${flag}<span class="why">${esc(clean(s.why))}</span></li>`;
  }
  const money = (n) => `$${Math.round(n || 0).toLocaleString('en-US')}`;
  function spendHtml(sp) {
    if (!sp) return '';
    const tiles = [[money(sp.usdTotal), 'all games so far'], [sp.usdPerShippedGame != null ? money(sp.usdPerShippedGame) : '–', 'per game that reached ship'],
      [sp.claudeShare != null ? `${Math.round(sp.claudeShare * 100)}%` : '–', 'of spend is Claude']];
    if (sp.codexWeek) tiles.push([`${sp.codexWeek.usedPct}%`, `of the Codex week used, resets ${shortDay(sp.codexWeek.resets)}`]);
    return `<div class="bstats">${tiles.map(([b, s]) => `<div><b>${esc(b)}</b><span>${esc(s)}</span></div>`).join('')}</div>`;
  }

  // The whole brief as HTML. opts: { now (ms), since: {at, first} }
  function html(b, opts) {
    const now = new Date(opts.now), since = opts.since;
    const sinceText = since.first ? 'the last 3 days' : `since you last looked, ${longDay(since.at)} ${String(since.at.getHours()).padStart(2, '0')}:${String(since.at.getMinutes()).padStart(2, '0')}`;
    const ds = (b.decisions || []).slice(0, 3), more = Math.max(0, (b.openDecisions || 0) - ds.length);
    const groups = groupEvents(b.events, isoDay(since.at));
    const stuck = b.stuck || [];
    const nStuckTasks = stuck.filter((s) => s.kind === 'blocked').length, nCaps = stuck.filter((s) => s.kind === 'over-cap').length;
    let h = `<div class="bhead"><h2 class="btitle">${esc(longDay(now))}</h2><p class="bsince">Daily brief · ${esc(sinceText)}</p></div>`;
    h += `<h3 class="bh">Decide today <span>${ds.length} of ${esc(b.openDecisions || 0)} open</span></h3>`;
    h += ds.length ? `<ol class="brows bdecide">${ds.map(decisionHtml).join('')}</ol><p class="bnote">The buttons copy one answer line; paste it in the chat.${more ? ` <button type="button" class="blink" data-view="needs" data-brief-jump="1">${more} more in Needs you</button>` : ''}</p>`
      : '<p class="bnote">Nothing to decide today.</p>';
    h += `<h3 class="bh">What changed <span>${groups.length} ${groups.length === 1 ? 'group' : 'groups'}</span></h3>`;
    h += groups.length ? `<ul class="brows bchanged">${groups.map((g) => `<li>${esc(g.label)}: ${g.names.map(nameHtml).join(', ')}${g.more ? ` and ${g.more} more` : ''}.</li>`).join('')}</ul>`
      : `<p class="bnote">Nothing new ${since.first ? 'in the last 3 days' : 'since you last looked'}.</p>`;
    h += `<h3 class="bh">Stuck <span>${nStuckTasks} ${nStuckTasks === 1 ? 'task' : 'tasks'}${nCaps ? `, ${nCaps} ${nCaps === 1 ? 'lane' : 'lanes'} over the limit` : ''}</span></h3>`;
    h += stuck.length ? `<ul class="brows bstuck">${stuck.map(stuckHtml).join('')}</ul>` : '<p class="bnote">Nothing is stuck.</p>';
    h += `<h3 class="bh">Spend so far <span>${esc((b.spend && b.spend.label) || 'estimate, not a bill')}</span></h3>${spendHtml(b.spend)}`;
    return h;
  }

  const api = { sinceFor, groupEvents, answerLine, decisionHtml, html, clean, isoDay, shortDay };
  if (typeof module === 'object' && module.exports) { module.exports = api; return; }
  root.BoardBrief = api;

  // ---- page ----
  const KEY = 'board.lastLook';
  let stored = null;
  try { stored = localStorage.getItem(KEY); } catch { /* private mode */ }
  const since = sinceFor(stored, Date.now());
  const shownAt = Date.now();
  const remember = () => { if (Date.now() - shownAt > 5000) { try { localStorage.setItem(KEY, new Date().toISOString()); } catch { /* ignore */ } } };
  addEventListener('pagehide', remember);
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') remember(); });
  async function loadBrief() {
    for (const url of ['data/brief.json', 'https://raw.githubusercontent.com/ChenHsieh/agent-studio-board/main/docs/data/brief.json']) {
      try { const r = await fetch(`${url}?t=${Date.now()}`, { cache: 'no-store' }); if (r.ok) { paint(await r.json()); return; } } catch { /* next */ }
    }
    const el = document.getElementById('brief'); if (el && !el.dataset.painted) el.innerHTML = '<p class="bnote">The daily brief could not load. The studio below is still live.</p>';
  }
  function paint(b) { const el = document.getElementById('brief'); if (!el) return; el.innerHTML = html(b, { now: Date.now(), since }); el.dataset.painted = '1'; }
  document.addEventListener('click', (e) => { if (e.target.closest('[data-brief-jump]')) setTimeout(() => { const g = document.getElementById('games'); if (g) g.scrollIntoView({ block: 'start' }); }, 50); });
  loadBrief();
  setInterval(loadBrief, 90_000);
})(typeof self !== 'undefined' ? self : this);
