// Which view a game belongs to. Kept apart from board.js so test/views.test.js can check it in node.
(function (root) {
  // inProgress comes from the server; older data files derive it from the task counts.
  const inProg = (g) => g.inProgress ?? (((g.taskCounts || {}).queued || 0) + ((g.taskCounts || {}).running || 0) > 0);
  // Archived: made for one moment (a defense, an event). Stays online, gets no more work, sits in no other list.
  const isArchived = (g) => !!g.archived;
  // Ready to try: a live version nobody has judged yet. A released game is already ready, so it never shows here.
  const isReady = (g) => !isArchived(g) && !g.released && g.stage === 'live' && !inProg(g) &&
    (!g.verdict || !!(g.lastChange && g.verdict.date && g.lastChange.slice(0, 10) > g.verdict.date));
  // A released game changed after the day it was released: the date of that change, else null.
  // releasedOn is Chen's local day; lastChange is a UTC time, so it is turned into a local day first.
  const localDay = (iso) => { const t = new Date(iso); if (Number.isNaN(t.getTime())) return String(iso).slice(0, 10);
    return `${t.getFullYear()}-${String(t.getMonth() + 1).padStart(2, '0')}-${String(t.getDate()).padStart(2, '0')}`; };
  const updatedSinceRelease = (g) => {
    if (!g.released || !g.releasedOn || !g.lastChange) return null;
    const d = localDay(g.lastChange);
    return d > g.releasedOn ? d : null;
  };
  // The latest change in words, without a task code in front; commit subjects that carry no words give nothing.
  const changeSummary = (text) => {
    const t = String(text || '').replace(/^[A-Z]\d?[A-Za-z]{1,4}\d+[a-z]?_[\w-]+:?\s*/, '').trim();
    return !t || /^WORKDIR\b/.test(t) ? '' : t;
  };
  const IN_VIEW = {
    needs: (g) => !isArchived(g) && !!g.needsYou,
    ready: isReady,
    released: (g) => !isArchived(g) && !!g.released,
    progress: (g) => !isArchived(g) && !!inProg(g),
    shelf: (g) => !isArchived(g) && g.stage === 'shelf',
    archived: isArchived,
    all: () => true,
    queue: () => false,
  };
  // Game numbers (board/numbers.tsv, P1BD07). Chen names ranges: "120 to 140" means 120..140 inclusive.
  const numLabel = (g) => (Number.isInteger(g.number) ? `#${g.number}` : '');
  // Search: "37" or "#37" matches game #37 exactly; any other text matches title, id and line.
  function findMatch(g, q) {
    const t = String(q || '').trim().toLowerCase();
    if (!t) return true;
    const m = /^#?\s*(\d+)$/.exec(t);
    if (m) return g.number === Number(m[1]);
    return (g.title + ' ' + g.id + ' ' + (g.line || '')).toLowerCase().includes(t);
  }
  // A range { from, to } (either may be null). A reversed range is read the right way round.
  function normRange(r) {
    const n = (v) => (v === '' || v == null || !Number.isFinite(Number(v)) ? null : Math.round(Number(v)));
    let from = n(r && r.from), to = n(r && r.to);
    if (from != null && to != null && from > to) [from, to] = [to, from];
    return { from, to };
  }
  function inRange(g, r) {
    const { from, to } = normRange(r);
    if (from == null && to == null) return true;
    if (!Number.isInteger(g.number)) return false;
    return (from == null || g.number >= from) && (to == null || g.number <= to);
  }
  // URL hash: #range=120-140 (also 120-, -140, or one number). Other hash keys (view=...) are left alone.
  function rangeFromHash(hash) {
    const m = /(?:^#?|&)range=(\d*)(-?)(\d*)/.exec(String(hash || ''));
    if (!m) return { from: null, to: null };
    return normRange({ from: m[1], to: m[2] ? m[3] : m[1] });
  }
  function rangeToHash(hash, r) {
    const { from, to } = normRange(r);
    const rest = String(hash || '').replace(/^#/, '').split('&').filter((p) => p && !p.startsWith('range='));
    if (from != null || to != null) rest.unshift(`range=${from ?? ''}-${to ?? ''}`);
    return rest.length ? '#' + rest.join('&') : '';
  }
  const copyList = (games) => games.map((g) => `${numLabel(g)} ${g.title}`.trim()).join('\n');
  const byNumber = (a, b) => (Number.isInteger(a.number) ? a.number : 1e9) - (Number.isInteger(b.number) ? b.number : 1e9);
  const api = { inProg, isArchived, isReady, updatedSinceRelease, changeSummary, localDay, IN_VIEW, numLabel, findMatch, normRange, inRange, rangeFromHash, rangeToHash, copyList, byNumber };
  root.BoardViews = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
