// Plan gauge shared by the board and the stats page. Reads data/quota.json (usage of the Codex weekly window,
// a straight-line pace over the last hours, and estimated spend for the other two routes). All figures are estimates.
const Gauge = (() => {
  const SOURCES = ['data/quota.json', 'https://raw.githubusercontent.com/ChenHsieh/agent-studio-board/main/docs/data/quota.json'];
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
  const money = (n) => `$${(n || 0).toFixed(n >= 100 ? 0 : 2)}`;
  const when = (sec) => new Date(sec * 1000).toLocaleString([], { weekday: 'short', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
  const clock = (sec) => new Date(sec * 1000).toLocaleString([], { weekday: 'short', hour: '2-digit', minute: '2-digit' });
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
  function pace(q) {
    if (!q || !q.ok) return 'Codex usage is not readable right now.';
    const early = q.early_estimate ? ' (early estimate)' : '';
    if (q.burn_percent_per_hour == null) return 'Pace not known yet.';
    if (q.runs_out_before_reset && q.eta_empty_epoch) return `At this pace: runs out ${clock(q.eta_empty_epoch)} (before the reset)${early}`;
    return `At this pace: lasts until the reset${early}`;
  }
  function bar(q) {
    const u = Math.min(100, Math.max(0, q.used_percent || 0));
    return `<span class="gbar" role="img" aria-label="${u}% of the weekly Codex plan used"><i style="width:${u}%"></i></span>`;
  }
  function spark(q) {
    const s = q.spark || [];
    if (s.length < 2) return '';
    const lo = Math.min(...s), hi = Math.max(...s), span = Math.max(hi - lo, 1);
    const pts = s.map((v, i) => `${(i / (s.length - 1) * 100).toFixed(1)},${(22 - (v - lo) / span * 20).toFixed(1)}`).join(' ');
    return `<svg class="gspark" viewBox="0 0 100 24" preserveAspectRatio="none" role="img" aria-label="Codex weekly usage, last ${s.length} samples"><polyline fill="none" stroke="currentColor" stroke-width="1.5" vector-effect="non-scaling-stroke" points="${pts}"/></svg>`;
  }
  function other(q) {
    const p = (q && q.providers) || {};
    const c = p.claude || {}, o = p.openrouter || {};
    const claude = `Claude: about ${money(c.inSessionUsdEst)} in session + ${money(c.meteredUsd)} metered API so far (estimate); cap not readable from here`;
    const or = `OpenRouter: ${money(o.usd)} recorded so far (estimate); no limit set`;
    return [claude, or];
  }
  // one compact block for the header and the stats page
  function compactHtml(q) {
    if (!q) return '<p class="gline">Plan usage is not available.</p>';
    const [claude, or] = other(q);
    const main = q.ok
      ? `${bar(q)}<span class="gtext"><b>Codex weekly plan</b> ${q.used_percent}% used, ${q.remaining_percent}% left · resets ${when(q.resets_at)} (in ${left(q.resets_at)}) · ${esc(pace(q))}</span>`
      : `<span class="gtext"><b>Codex weekly plan</b> ${esc(pace(q))}</span>`;
    return `<div class="gline">${main}</div><div class="gline gother"><span>${esc(claude)}</span><span>${esc(or)}</span></div>`;
  }
  // the full panel for the Queue view
  function fullHtml(q) {
    if (!q) return '<p class="gline">Plan usage is not available.</p>';
    const [claude, or] = other(q);
    const codex = q.ok ? `
      <div class="gbig">${bar(q)}<span class="gnum"><b>${q.used_percent}%</b> used · <b>${q.remaining_percent}%</b> left</span></div>
      <dl class="gdl">
        <div><dt>Limit</dt><dd>Weekly window (${Math.round((q.window_minutes || 10080) / 1440)} days)</dd></div>
        <div><dt>Resets</dt><dd>${when(q.resets_at)} (in ${left(q.resets_at)})</dd></div>
        <div><dt>Pace</dt><dd>${q.burn_percent_per_hour == null ? 'not known yet' : `${q.burn_percent_per_hour}% of the week per hour`}${q.early_estimate ? ' <span class="gtag">early estimate</span>' : ''}</dd></div>
      </dl>
      <p class="gpace">${esc(pace(q).replace(' (early estimate)', ''))}</p>
      <p class="gq">Queue of ${q.codex_tasks_ready} ready Codex tasks is about ${q.est_percent_for_ready_queue}% of the week.</p>
      ${spark(q)}` : `<p class="gpace">${esc(pace(q))}</p>`;
    return `<div class="gpanel"><h3>Codex plan (ChatGPT)</h3>${codex}</div>
      <div class="gpanel"><h3>Claude and OpenRouter</h3><p class="gq">${esc(claude)}</p><p class="gq">${esc(or)}</p></div>`;
  }
  return { load, compactHtml, fullHtml, esc, when, left };
})();
