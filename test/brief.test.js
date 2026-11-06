// node test/brief.test.js : the daily brief's pure parts (docs/brief.js) on a fixture brief.json.
const assert = require('node:assert/strict');
const B = require('../docs/brief.js');
const now = Date.parse('2026-11-06T09:00:00');
const fx = {
  openDecisions: 5,
  decisions: [
    { rank: 1, game: 'play-template', gameName: 'The shared game kit', question: 'Bigger text fails the layout check.', pick: 'Apply the change.', kind: 'cheap', daysWaiting: 14, goesAheadOn: '2026-11-09', blocksGames: 17, blocksTasks: 0, ifNothing: 'Goes ahead with the pick on 2026-11-09.' },
    { rank: 2, game: 'nobody-looking', gameName: '#127 Nobody Looking', question: 'Check B fails drag boards (P2FM04_even-water).', pick: 'Yes.', kind: 'cheap', daysWaiting: 7, goesAheadOn: '2026-11-09', blocksGames: 3, blocksTasks: 4 },
    { rank: 3, game: 'colony-count', gameName: '#95 Colony Count', question: 'The counter is off.', pick: 'Sign up once.', kind: 'only-you', daysWaiting: 1, goesAheadOn: null, blocksGames: 5, blocksTasks: 1, ifNothing: 'Nothing happens until you answer; no work is spent on it.' },
    { rank: 4, game: 'x', gameName: 'X', question: 'q', kind: 'cheap' },
  ],
  events: [
    { kind: 'released', game: 'a', gameName: '#1 Alpha', at: '2026-11-05' },
    { kind: 'released', game: 'b', gameName: '#2 Beta', at: '2026-10-01' },
    { kind: 'revise', game: 'c', gameName: '#3 Gamma', at: '2026-11-04' },
    { kind: 'regressed', game: 'd', gameName: '#4 Delta', at: '2026-09-01' },
  ],
  stuck: [{ kind: 'blocked', gameName: '#91 Tractatus Tree', days: 16, why: 'Too large for one pass.' }, { kind: 'over-cap', lane: 'Building', count: 18, cap: 6 }],
  spend: { label: 'estimate, not a bill', usdTotal: 2903, usdPerShippedGame: 70, claudeShare: 0.98, codexWeek: { usedPct: 21, resets: '2026-11-11' } },
};
const s0 = B.sinceFor(null, now); assert.equal(s0.first, true); assert.equal(+s0.at, now - 3 * 86400000);
const s1 = B.sinceFor('2026-11-04T08:00:00', now); assert.equal(s1.first, false); assert.equal(B.isoDay(s1.at), '2026-11-04');
console.log('ok  last look: stored time, or the last 3 days on a first visit');
const g = B.groupEvents(fx.events, '2026-11-04');
assert.deepEqual(g.map((x) => x.kind), ['released', 'revise', 'regressed']); assert.equal(g[0].count, 1);
console.log('ok  What changed: only events since the last look, regressions always, fixed order');
assert.equal(B.answerLine(fx.decisions[0], 'yes'), 'ask|play-template|yes');
const h = B.html(fx, { now, since: s1 });
assert.equal((h.match(/class="bdec"/g) || []).length, 3); console.log('ok  three decision cards');
assert.ok(h.includes('data-copy="ask|play-template|yes"') && h.includes('data-copy="ask|colony-count|I will do it"')); console.log('ok  buttons copy ask|<game>|<choice>');
assert.ok(h.includes('Goes ahead on Mon 9 Nov') && h.includes('Nothing happens until you answer')); console.log('ok  cheap ones say when they go ahead; only-you ones say nothing happens');
assert.ok(h.includes('2 more in Needs you')); console.log('ok  the rest are one tap away');
const text = h.replace(/<[^>]+>/g, ' ');
assert.ok(!/P[0-9][A-Za-z]+[0-9]+_/.test(text)); console.log('ok  no task id in the brief text');
assert.ok(text.includes('$2,903') && text.includes('98%') && text.includes('21%')); console.log('ok  spend tiles');
assert.ok(text.includes('Building: 18 games, limit 6') || /Building:\s+18\s+games, limit 6/.test(text)); console.log('ok  stuck lanes over the cap');
console.log('ALL OK');
