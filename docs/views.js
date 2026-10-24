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
  const api = { inProg, isArchived, isReady, updatedSinceRelease, changeSummary, localDay, IN_VIEW };
  root.BoardViews = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
