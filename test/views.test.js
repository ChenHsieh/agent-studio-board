// node test/views.test.js : which view each fixture game lands in (docs/views.js).
const assert = require('node:assert/strict');
const V = require('../docs/views.js');
const games = {
  fresh: { id: 'fresh', stage: 'live', inProgress: false, verdict: null },
  judged: { id: 'judged', stage: 'live', inProgress: false, verdict: { verdict: 'ship', date: '2026-10-20' }, lastChange: '2026-10-19T10:00:00Z' },
  newAfterVerdict: { id: 'newAfterVerdict', stage: 'live', inProgress: false, verdict: { verdict: 'revise', date: '2026-10-20' }, lastChange: '2026-10-22T10:00:00Z' },
  released: { id: 'released', stage: 'live', inProgress: false, verdict: null, released: true, releasedOn: '2026-10-23', lastChange: '2026-10-23T09:00:00Z' },
  releasedUpdated: { id: 'releasedUpdated', stage: 'live', inProgress: false, verdict: { verdict: 'release', date: '2026-10-20' }, released: true, releasedOn: '2026-10-23', lastChange: '2026-10-25T09:00:00Z' },
  releasedAsked: { id: 'releasedAsked', stage: 'live', inProgress: false, released: true, releasedOn: '2026-10-23', needsYou: 'Pick a colour. Suggest: blue.' },
  building: { id: 'building', stage: 'building', inProgress: true },
  archived: { id: 'archived', stage: 'live', inProgress: false, archived: true, archivedOn: '2026-10-23', needsYou: 'old ask' },
};
const inView = (v) => Object.values(games).filter(V.IN_VIEW[v]).map((g) => g.id).sort();
assert.deepEqual(inView('ready'), ['fresh', 'newAfterVerdict']); console.log('ok  Ready to try: unjudged live versions only; no released game, no archived game');
assert.equal(V.isReady(games.released), false); assert.equal(V.isReady(games.releasedUpdated), false); console.log('ok  isReady is false for every released game, updated or not');
assert.deepEqual(inView('released'), ['released', 'releasedAsked', 'releasedUpdated']); console.log('ok  Released view lists the released games');
assert.equal(V.updatedSinceRelease(games.releasedUpdated), '2026-10-25'); assert.equal(V.updatedSinceRelease(games.released), null); assert.equal(V.updatedSinceRelease(games.fresh), null);
console.log('ok  "Updated since release" only when the last change is after the release day');
assert.deepEqual(inView('needs'), ['releasedAsked']); console.log('ok  a released game is in Needs you only with an asks.tsv row (needsYou)');
assert.equal(V.changeSummary('P3OR02_remote-viewer-judge-helpers-test: WORKDIR'), ''); assert.equal(V.changeSummary('P1LH00 live : F-key hints gone'), 'P1LH00 live : F-key hints gone');
assert.equal(V.changeSummary('P2RL15_credits-panel-time-material: credits list every source'), 'credits list every source'); console.log('ok  the change summary drops task codes and empty commit subjects');
assert.deepEqual(inView('archived'), ['archived']); for (const v of ['needs', 'ready', 'released', 'progress', 'shelf']) assert.ok(!inView(v).includes('archived'), v);
console.log('ok  an archived game shows only in Archived (and All), even with an old ask');
module.exports = { games, inView };

// Game numbers (P1BD07): search by number, from/to range, the URL hash and the copied list.
const nums = [{ id: 'a', title: 'Grub Band', number: 120 }, { id: 'b', title: 'Lie Flat', number: 140 }, { id: 'c', title: 'Tell', number: 37 }, { id: 'd', title: 'Odd one', number: 141 }];
assert.deepEqual(nums.filter((g) => V.findMatch(g, '37')).map((g) => g.id), ['c']);
assert.deepEqual(nums.filter((g) => V.findMatch(g, '#37')).map((g) => g.id), ['c']);
assert.deepEqual(nums.filter((g) => V.findMatch(g, 'lie')).map((g) => g.id), ['b']);
console.log('ok  search "37" and "#37" find game #37 only; words still search titles');
const inR = (r) => nums.filter((g) => V.inRange(g, r)).map((g) => g.number);
assert.deepEqual(inR({ from: 120, to: 140 }), [120, 140]); assert.deepEqual(inR({ from: 140, to: 120 }), [120, 140]);
assert.deepEqual(inR({ from: 138, to: '' }), [140, 141]); assert.deepEqual(inR({ from: null, to: null }), [120, 140, 37, 141]);
assert.equal(V.inRange({ id: 'x', title: 'No number' }, { from: 1, to: 999 }), false);
console.log('ok  range keeps from <= number <= to, inclusive; reversed boxes are read the right way round');
assert.deepEqual(V.rangeFromHash('#range=120-140'), { from: 120, to: 140 });
assert.deepEqual(V.rangeFromHash('#view=checklist&range=140-120'), { from: 120, to: 140 });
assert.deepEqual(V.rangeFromHash('#range=37'), { from: 37, to: 37 });
assert.deepEqual(V.rangeFromHash('#range=120-'), { from: 120, to: null });
assert.deepEqual(V.rangeFromHash(''), { from: null, to: null });
assert.equal(V.rangeToHash('', { from: 120, to: 140 }), '#range=120-140');
assert.equal(V.rangeToHash('#range=1-2&view=checklist', { from: 5, to: 9 }), '#range=5-9&view=checklist');
assert.equal(V.rangeToHash('#range=1-2', { from: '', to: '' }), '');
console.log('ok  #range=120-140 in the URL round-trips and keeps other hash keys');
assert.equal(V.copyList([...nums].sort(V.byNumber).slice(0, 2)), '#37 Tell\n#120 Grub Band');
console.log('ok  Copy list gives "#37 Title" lines in number order');
