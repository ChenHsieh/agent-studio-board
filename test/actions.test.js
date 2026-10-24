// node test/actions.test.js : the action sheet's split (docs/actions.js) must equal `request_expand.py --dry-run` on two fixture selections.
const assert = require('node:assert/strict');
const fs = require('node:fs'), os = require('node:os'), path = require('node:path');
const { spawnSync } = require('node:child_process');
const A = require('../docs/actions.js');
const PIPE_SRC = process.env.PIPELINE || '/scratch/ch29576/pipeline';

// fixture: 8 games with a mix of checklist cells
const games = [
  ['alpha', 1, 'no'], ['beta', 2, 'yes'], ['gamma', 3, 'no'], ['delta', 4, 'unknown'], ['eps', 5, 'no'], ['zeta', 6, 'unknown'], ['eta', 7, 'yes'], ['theta', 8, 'no'],
];
const rows = games.map(([slug, number, v]) => ({ slug, number, title: slug, checks: { story: { v }, a11y: { v: 'no' } } }));
const running = new Set(['alpha', 'zeta']), held = new Set(['gamma']);
const story = { id: 'story', skipIf: 'story', kind: 'claude', estUsd: 3.6, who: 'anyone' };
const review = { id: 'review', skipIf: null, kind: 'claude', estUsd: 6, who: 'anyone' };

// unit checks
let g = A.split(story, rows, { running, held });
assert.deepEqual(g.skipped.map((r) => r.slug), ['beta', 'eta']);
assert.deepEqual(g.held.map((r) => r.slug), ['gamma']);
assert.deepEqual(g.wait.map((r) => r.slug), ['alpha', 'zeta']); // a running build wins over an unknown cell
assert.deepEqual(g.check.map((r) => r.slug), ['delta']);         // unknown cell and nothing running -> checked first
assert.deepEqual(g.now.map((r) => r.slug), ['eps', 'theta']);
console.log('ok  split: skipped, held, wait, check, now');
assert.equal(A.selectorText([5, 3, 4, 9, 3]), '3-5, 9');
assert.equal(A.taskCount(review, A.split(review, rows, {})), 4);  // 8 games, two per review
const e = A.estimate(story, g, { spendLineUsd: 40 });
assert.equal(e.tasks, 5); assert.ok(Math.abs(e.usd - 18) < 1e-9); assert.equal(e.over, false);
assert.equal(A.estimate({ ...story, estUsd: 9 }, g, { spendLineUsd: 40 }).over, true);
assert.equal(A.reqLine(story, [3, 4, 5, 9], e, false, 'a|b'), 'REQ|story|3-5, 9|a b|est=18|spend=no');
assert.equal(A.barWords({ done: 2, running: 1, waiting: 3 }), '2 done, 1 running, 3 waiting');
console.log('ok  selector text, task count, estimate, spend line, request line, bar words');

// the same fixture through request_expand.py --dry-run
if (!fs.existsSync(`${PIPE_SRC}/queue/request_expand.py`)) { console.log('skip  request_expand.py not found; page-only checks passed'); process.exit(0); }
const T = fs.mkdtempSync(path.join(os.tmpdir(), 'ux06_'));
for (const d of ['queue/running', 'queue/request_templates', 'board']) fs.mkdirSync(`${T}/${d}`, { recursive: true });
for (const f of ['selector.py', 'request_paste.py', 'request_expand.py']) fs.copyFileSync(`${PIPE_SRC}/queue/${f}`, `${T}/queue/${f}`);
fs.copyFileSync(`${PIPE_SRC}/board/actions.tsv`, `${T}/board/actions.tsv`);
fs.writeFileSync(`${T}/board/numbers.tsv`, games.map(([s, n]) => `${s}\t${n}`).join('\n') + '\n');
fs.writeFileSync(`${T}/board/play_queue.tsv`, 'gamma\t2026-10-22\ttry it\n');
fs.writeFileSync(`${T}/board/checks.json`, JSON.stringify({ games: rows.map((r) => ({ slug: r.slug, number: r.number, checks: r.checks })) }));
fs.writeFileSync(`${T}/board/status.json`, JSON.stringify({ games: rows.map((r) => ({ id: r.slug, title: r.slug })) }));
for (const s of running) fs.writeFileSync(`${T}/queue/running/P1x_${s}.session.txt`, `WORKDIR ${T}/repos/${s}\nROUTE: agent=any model=sonnet effort=high\n`);
const dry = (sel, action) => {
  const r = spawnSync('python3', ['-I', `${T}/queue/request_expand.py`, '--dry-run', '--line', `REQ|${action}|${sel}||est=0|spend=ok`], { env: { ...process.env, PIPE: T, REPOS: `${T}/repos` }, encoding: 'utf8' });
  assert.equal(r.status, 0, r.stderr);
  const out = {}; for (const m of r.stdout.matchAll(/^ {3}(now|wait|check|held|skipped) +#(\d+) /gm)) (out[m[1]] ||= []).push(Number(m[2]));
  return out;
};
for (const [sel, lo, hi] of [['1-8', 1, 8], ['2, 4-6', null, null]]) {
  const picked = sel === '1-8' ? rows : rows.filter((r) => [2, 4, 5, 6].includes(r.number));
  const js = A.split(story, picked, { running, held }); const jsN = {}; for (const k of Object.keys(js)) if (js[k].length) jsN[k] = js[k].map((r) => r.number);
  assert.deepEqual(dry(sel, 'story'), jsN, `page split equals planner split for ${sel}`);
  console.log(`ok  page split equals request_expand.py --dry-run for "${sel}"`);
}
fs.rmSync(T, { recursive: true, force: true });
