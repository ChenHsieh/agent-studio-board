// Board actions (P1UX06): pure functions for the action sheet and the request cards. Tested in node by test/actions.test.js.
// The split rules are the ones queue/request_expand.py uses, so the page and the planner agree on what a request does:
//   skipped = the checklist cell is already yes; held = in the play queue (waits for the owner's own verdict);
//   wait = a build is running on that game right now; check = the cell is not checked yet; now = queue at once.
// The page writes nothing: it only composes the line REQ|action|selector|note|est=|spend= for the owner to paste into the chat.
(function (root) {
  const GROUPS = [
    ['now', 'Queued now'], ['wait', 'Wait for the build running now'], ['check', 'Checked first (cell not checked yet)'],
    ['held', 'Held for your own verdict'], ['skipped', 'Skipped (already yes)'],
  ];
  // rows: checklist rows (number, slug, title, checks); ctx: { running: Set of slugs with a running task, held: Set of slugs in the play queue }
  function split(action, rows, ctx = {}) {
    const out = { now: [], wait: [], check: [], held: [], skipped: [] };
    const cell = action.skipIf;
    for (const r of rows) {
      const v = cell ? ((r.checks[cell] || {}).v || 'unknown') : 'no';
      if (cell && v === 'yes') out.skipped.push(r);
      else if (ctx.held && ctx.held.has(r.slug)) out.held.push(r);
      else if (ctx.running && ctx.running.has(r.slug)) out.wait.push(r);
      else if (cell && v === 'unknown') out.check.push(r);
      else out.now.push(r);
    }
    return out;
  }
  // Number of tasks the planner will write: one per game, one per two games for a review, one sweep for the release checks.
  function taskCount(action, groups) {
    const n = groups.now.length + groups.check.length + groups.wait.length;
    if (action.id === 'review') return Math.ceil(n / 2);
    if (action.id === 'release-checks') return n ? 1 : 0;
    return n;
  }
  // Estimate: per-task figure from actions.json (the same one the planner uses). Codex work is counted in the share of the week.
  function estimate(action, groups, meta = {}) {
    const n = taskCount(action, groups);
    const usd = action.kind === 'claude' ? n * action.estUsd : 0;
    const codexShare = action.kind === 'codex' ? n * (meta.codexSharePerTask || 0) : 0;
    const over = usd > (meta.spendLineUsd || 40) || codexShare > (meta.spendLineCodexShare || 0.1);
    return { tasks: n, usd, codexShare, over };
  }
  // 3,4,5,9 -> "3-5, 9": the selector the planner reads.
  function selectorText(numbers) {
    const ns = [...new Set(numbers)].sort((a, b) => a - b), parts = [];
    for (let i = 0; i < ns.length;) {
      let j = i; while (j + 1 < ns.length && ns[j + 1] === ns[j] + 1) j++;
      parts.push(j > i ? `${ns[i]}-${ns[j]}` : `${ns[i]}`); i = j + 1;
    }
    return parts.join(', ');
  }
  const clean = (s) => String(s || '').replace(/[|\t\r\n]+/g, ' ').trim().slice(0, 200);
  function reqLine(action, numbers, est, ok, note) {
    return `REQ|${action.id}|${selectorText(numbers)}|${clean(note)}|est=${Math.round(est.usd)}|spend=${ok ? 'ok' : 'no'}`;
  }
  // Request cards (data/requests.json): words for the bar, never task ids.
  function barWords(t) {
    const parts = [`${t.done || 0} done`, `${t.running || 0} running`, `${t.waiting || 0} waiting`];
    if (t.stopped) parts.push(`${t.stopped} stopped`);
    return parts.join(', ');
  }
  const api = { GROUPS, split, taskCount, estimate, selectorText, reqLine, barWords };
  root.BoardActions = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
