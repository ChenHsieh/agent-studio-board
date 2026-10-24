// node test/checklist.test.js : range, chip and state filtering for the Checklist view (docs/checklist.js), on fixture data.
const assert = require('node:assert/strict');
const C = require('../docs/checklist.js');
const ck = (o) => Object.fromEntries(C.COLUMNS.map(([k]) => [k, { v: o[k] || 'yes', source: 'x', at: '2026-10-23' }]));
const checks = { games: [
  { number: 120, slug: 'grub-band', title: 'grub-band', checks: ck({ story: 'no', first_minute: 'ran' }) },
  { number: 121, slug: 'lot-waits', title: 'lot-waits', checks: ck({ story: 'unknown', a11y: 'unknown' }) },
  { number: 122, slug: 'coat-corridor', title: 'coat-corridor', checks: ck({}) },
  { number: 141, slug: 'odd', title: 'odd', checks: ck({ credits: 'no' }) },
  { number: 37, slug: 'tell', title: 'tell', checks: ck({ story: 'no' }) },
] };
const games = [{ id: 'grub-band', title: 'Grub Band', state: 'playable' }, { id: 'lot-waits', title: 'The Lot Waits', state: 'revise' },
  { id: 'coat-corridor', title: 'Coat Corridor', state: 'playable' }, { id: 'odd', title: 'Odd', state: 'ship' }, { id: 'tell', title: 'Tell', state: 'released' }];
const all = C.rows(checks, games);
const nums = (rs) => rs.map((r) => r.number);
assert.deepEqual(nums(all), [37, 120, 121, 122, 141]); assert.equal(all[1].title, 'Grub Band'); assert.equal(all[1].state, 'playable');
assert.deepEqual(nums(C.filter(all, { range: { from: 120, to: 140 } })), [120, 121, 122]);
assert.deepEqual(nums(C.filter(all, { range: { from: 140, to: 120 } })), [120, 121, 122]);
console.log('ok  range 120 to 140 keeps 120, 121, 122 (inclusive; reversed boxes work)');
assert.deepEqual(nums(C.filter(all, { range: { from: 120, to: 140 }, chips: ['story'] })), [120, 121]);
assert.deepEqual(nums(C.filter(all, { chips: ['first'] })), [120]);
assert.deepEqual(nums(C.filter(all, { chips: ['unchecked'] })), [120, 121]);
assert.deepEqual(nums(C.filter(all, { chips: ['red'] })), [37, 120, 141]);
assert.deepEqual(nums(C.filter(all, { chips: ['red', 'unchecked'] })), [120]);
console.log('ok  chips: missing story line, missing first minute, not checked yet, any red (chips combine with AND)');
assert.deepEqual(nums(C.filter(all, { state: 'playable' })), [120, 122]);
assert.deepEqual(nums(C.filter(all, { q: '#37' })), [37]);
console.log('ok  state select and #number search');
const cnt = C.counts(C.filter(all, { range: { from: 120, to: 140 } }));
assert.deepEqual(cnt.story, { no: 1, notRun: 1 }); assert.deepEqual(cnt.first_minute, { no: 0, notRun: 1 }); assert.deepEqual(cnt.a11y, { no: 0, notRun: 1 });
console.log('ok  header counts "<n> no · <n> not run" for the rows shown');
assert.equal(C.word('yes'), 'yes'); assert.equal(C.word('no'), 'no'); assert.equal(C.word('unknown'), 'not run'); assert.equal(C.word('ran'), 'no score');
console.log('ok  every cell value is a word');
assert.equal(C.copyLines([all[2], all[1]]), '#120 Grub Band\n#121 The Lot Waits');
assert.equal(C.viewFromHash('#range=120-140&view=checklist'), 'checklist');
assert.equal(C.viewToHash('#range=120-140', 'checklist'), '#range=120-140&view=checklist');
assert.equal(C.viewToHash('#range=120-140&view=checklist', null), '#range=120-140');
console.log('ok  Copy list lines and #range=120-140&view=checklist');
