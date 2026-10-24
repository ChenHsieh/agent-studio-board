// Checklist by game (P1UX03): rows = numbered games, columns = checks from data/checks.json (board/checks.py).
// Pure functions only (tested in node by test/checklist.test.js); board.js draws them.
(function (root) {
  const V = root.BoardViews || (typeof require !== 'undefined' ? require('./views.js') : null);
  const COLUMNS = [
    ['story', 'Story line'], ['first_minute', 'First minute'], ['a11y', 'Big text and colour'], ['expect', 'What to expect'],
    ['credits', 'Credits'], ['saves', 'Saves carry over'], ['standard', 'Preview and share'], ['live', 'Live page check'],
  ];
  // Every value in words; colour is only a second cue.
  const WORD = { yes: 'yes', no: 'no', unknown: 'not run', ran: 'no score' };
  const word = (v) => WORD[v] || 'not run';
  const notRun = (v) => v === 'unknown' || v === 'ran' || !WORD[v];
  const CHIPS = [
    ['story', 'Missing story line', (r) => r.checks.story.v !== 'yes'],
    ['first', 'Missing first minute', (r) => r.checks.first_minute.v !== 'yes'],
    ['unchecked', 'Not checked yet', (r) => COLUMNS.some(([k]) => notRun(r.checks[k].v))],
    ['red', 'Any red', (r) => COLUMNS.some(([k]) => r.checks[k].v === 'no')],
  ];
  const STATE_LABEL = { idea: 'Idea', gated: 'Passed the taste check', building: 'Building', playable: 'Playable', 'in-review': 'In review',
    revise: 'Revise', ship: 'Ship', released: 'Released', shelved: 'Shelved', archived: 'Archived' };
  const stateLabel = (s) => STATE_LABEL[s] || (s ? String(s) : 'Not on the board');
  // Join checks.json rows with the board games (title, state, url) by slug.
  function rows(checks, games) {
    const by = new Map((games || []).map((g) => [g.id, g]));
    const unk = { v: 'unknown', source: '', at: null };
    return ((checks && checks.games) || []).map((c) => {
      const g = by.get(c.slug) || {};
      const cells = {}; for (const [k] of COLUMNS) cells[k] = (c.checks && c.checks[k]) || unk;
      return { number: c.number, slug: c.slug, title: g.title || c.title || c.slug, state: g.state || null, url: g.url || '', checks: cells };
    }).sort((a, b) => a.number - b.number);
  }
  // opts: { range: {from, to}, chips: [ids], state: '' or a state, q: search text }
  function filter(all, opts = {}) {
    const chips = CHIPS.filter(([id]) => (opts.chips || []).includes(id));
    return all.filter((r) => (!V || V.inRange(r, opts.range || {})) && (!opts.state || r.state === opts.state)
      && (!opts.q || !V || V.findMatch({ ...r, id: r.slug, line: '' }, opts.q)) && chips.every(([, , f]) => f(r)));
  }
  // Header under each column: "<n> no · <n> not run" for the rows shown.
  function counts(shown) {
    const out = {};
    for (const [k] of COLUMNS) out[k] = { no: shown.filter((r) => r.checks[k].v === 'no').length, notRun: shown.filter((r) => notRun(r.checks[k].v)).length };
    return out;
  }
  const copyLines = (picked) => [...picked].sort((a, b) => a.number - b.number).map((r) => `#${r.number} ${r.title}`).join('\n');
  // The view in the URL hash: #range=120-140&view=checklist
  function viewFromHash(hash) { const m = /(?:^#?|&)view=([a-z-]+)/.exec(String(hash || '')); return m ? m[1] : null; }
  function viewToHash(hash, view) {
    const rest = String(hash || '').replace(/^#/, '').split('&').filter((p) => p && !p.startsWith('view='));
    if (view) rest.push(`view=${view}`);
    return rest.length ? '#' + rest.join('&') : '';
  }
  const api = { COLUMNS, CHIPS, word, notRun, stateLabel, rows, filter, counts, copyLines, viewFromHash, viewToHash };
  root.BoardChecklist = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
