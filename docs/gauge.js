// Plan gauge shared by the board and the stats page. Reads data/quota.json (usage of each Codex window, 5-hour and weekly,
// a straight-line pace over the last hours, and estimated spend for the other two routes). All figures are estimates.
const Gauge = (() => {
  const SOURCES = ['data/quota.json', 'https://raw.githubusercontent.com/ChenHsieh/agent-studio-board/main/docs/data/quota.json'];
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
  const money = (n) => `$${(n || 0).toFixed(n >= 100 ? 0 : 2)}`;
  const when = (sec) => new Date(sec * 1000).toLocaleString([], { weekday: 'short', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
  const clock = (sec) => new Date(sec * 1000).toLocaleString([], { weekday: 'short', hour: '2-digit', minute: '2-digit' });
  const clockHM = (sec) => new Date(sec * 1000).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: false });
  function left(sec) {
    const m = Math.max(0, Math.round((sec * 1000 - Date.now()) / 60000));
    const d = Math.floor(m / 1440), h = Math.floor((m % 1440) / 60);
    return d ? `${d} d ${h} h` : h ? `${h} h ${m % 60} min` : `${m} min`;
  }
  async function load() {
    for (const url of SOURCES) {
      try { const r = await fetch(`${url}?t=${Date.now()}`, { cache: 'no-store' }); if (r.ok) return await r.json(); } catch { /* next */ }
    }
    return null;
  }
  // Windows: data/quota.json carries windows {'5h', 'weekly'} (ChatGPT Plus has both; Pro has only the weekly one).
  // Older data without windows is shown as one weekly window.
  const NAMES = { '5h': '5-hour window', weekly: 'Weekly window' };
  function wins(q) {
    if (q.windows && Object.keys(q.windows).length) return ['5h', 'weekly'].filter((k) => q.windows[k]).map((k) => [k, q.windows[k]]);
    return [['weekly', q]];
  }
  function plan(q) {
    const p = { plus: 'Plus', pro: 'Pro', prolite: 'Pro' }[q && q.plan_type];
    return p ? `Codex plan (ChatGPT ${p})` : 'Codex plan (ChatGPT)';
  }
  function pace(w) {
    if (!w) return 'Codex usage is not readable right now.';
    const early = w.early_estimate ? ' (early estimate)' : '';
    if ((w.used_percent || 0) >= 100) return 'Used up until the reset';
    if (w.burn_percent_per_hour == null) return 'Pace not known yet.';
    if (w.runs_out_before_reset && w.eta_empty_epoch) return `At this pace: runs out ${clock(w.eta_empty_epoch)} (before the reset)${early}`;
    return `At this pace: lasts until the reset${early}`;
  }
  function bar(w, name) {
    const u = Math.min(100, Math.max(0, w.used_percent || 0));
    return `<span class="gbar" role="img" aria-label="${u}% of the Codex ${name.toLowerCase()} used"><i style="width:${u}%"></i></span>`;
  }
  function spark(w, name) {
    const s = w.spark || [];
    if (s.length < 2) return '';
    const lo = Math.min(...s), hi = Math.max(...s), span = Math.max(hi - lo, 1);
    const pts = s.map((v, i) => `${(i / (s.length - 1) * 100).toFixed(1)},${(22 - (v - lo) / span * 20).toFixed(1)}`).join(' ');
    return `<svg class="gspark" viewBox="0 0 100 24" preserveAspectRatio="none" role="img" aria-label="Codex ${name.toLowerCase()} usage, last ${s.length} samples"><polyline fill="none" stroke="currentColor" stroke-width="1.5" vector-effect="non-scaling-stroke" points="${pts}"/></svg>`;
  }
  function lanes(q) {
    return q.lanes_target == null ? '' : `Codex lanes allowed now: ${q.lanes_target}.`;
  }
  function other(q) {
    const p = (q && q.providers) || {};
    const c = p.claude || {}, o = p.openrouter || {};
    const claude = `Claude: about ${money(c.inSessionUsdEst)} in session + ${money(c.meteredUsd)} metered API so far (estimate); cap not readable from here`;
    const or = `OpenRouter: ${money(o.usd)} recorded so far (estimate); no limit set`;
    return [claude, or];
  }
  // one compact block for the header and the stats page: one line per window, the binding one marked
  function compactHtml(q) {
    if (!q) return '<p class="gline">Plan usage is not available.</p>';
    const [claude, or] = other(q);
    const rows = q.ok
      ? wins(q).map(([k, w]) => {
        const name = NAMES[k], bind = q.binding === k && wins(q).length > 1 ? ' <span class="gtag">binding</span>' : '';
        const rem = w.remaining_percent ?? Math.round(100 - (w.used_percent || 0));
        return `<div class="gline">${bar(w, name)}<span class="gtext"><b>Codex ${name.toLowerCase()}</b>${bind} ${w.used_percent}% used, ${rem}% left · resets ${when(w.resets_at)} (in ${left(w.resets_at)}) · ${esc(pace(w))}</span></div>`;
      }).join('')
      : `<div class="gline"><span class="gtext"><b>${esc(plan(q))}</b> ${esc(pace(null))}</span></div>`;
    return `${rows}<div class="gline gother"><span>${esc(claude)}</span><span>${esc(or)}</span></div>`;
  }
  function windowHtml(q, k, w) {
    const name = NAMES[k], rem = w.remaining_percent ?? Math.round(100 - (w.used_percent || 0));
    const span = k === '5h' ? '5 hours' : `${Math.round((w.window_minutes || 10080) / 1440)} days`;
    const bind = q.binding === k && wins(q).length > 1 ? ' <span class="gtag">binding</span>' : '';
    return `<div class="gwin"><h4>${name}${bind}</h4>
      <div class="gbig">${bar(w, name)}<span class="gnum"><b>${w.used_percent}%</b> used · <b>${rem}%</b> left</span></div>
      <dl class="gdl">
        <div><dt>Length</dt><dd>${span}</dd></div>
        <div><dt>Resets</dt><dd>${when(w.resets_at)} (in ${left(w.resets_at)})</dd></div>
        <div><dt>Pace</dt><dd>${w.burn_percent_per_hour == null ? 'not known yet' : `${w.burn_percent_per_hour}% of this window per hour`}${w.early_estimate ? ' <span class="gtag">early estimate</span>' : ''}</dd></div>
        <div><dt>Runs out</dt><dd>${esc(pace(w).replace(' (early estimate)', '').replace('At this pace: ', '').replace(/^runs out /, ''))}</dd></div>
      </dl>${spark(w, name)}</div>`;
  }
  // the full panel for the Queue view
  function fullHtml(q) {
    if (!q) return '<p class="gline">Plan usage is not available.</p>';
    const [claude, or] = other(q);
    const ws = q.ok ? wins(q) : [];
    const codex = q.ok ? `
      ${ws.map(([k, w]) => windowHtml(q, k, w)).join('')}
      ${ws.length > 1 ? `<p class="gpace">The ${NAMES[q.binding].toLowerCase()} is the binding limit: it runs out first. ${esc(lanes(q))}</p>` : (lanes(q) ? `<p class="gpace">${esc(lanes(q))}</p>` : '')}
      <p class="gq">Queue of ${q.codex_tasks_ready} ready Codex tasks is about ${q.est_percent_for_ready_queue}% of the ${ws.length > 1 ? NAMES[q.binding].toLowerCase() : 'week'}.</p>` : `<p class="gpace">${esc(pace(null))}</p>`;
    const w = q.watch || {};
    const watch = `<p class="gwatch">${w.lastCheck ? `Last check ${clockHM(w.lastCheck)} · ` : ''}Quota watch: every ${w.everyMin || 10} min${w.resetEvent ? `<br><b>Quota came back at ${when(w.resetEvent)}</b>` : ''}</p>`;
    return `<div class="gpanel"><h3>${esc(plan(q))}</h3>${codex}${watch}</div>
      <div class="gpanel"><h3>Claude and OpenRouter</h3><p class="gq">${esc(claude)}</p><p class="gq">${esc(or)}</p></div>`;
  }
  return { load, compactHtml, fullHtml, esc, when, left };
})();
