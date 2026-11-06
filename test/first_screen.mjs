// node test/first_screen.mjs <board url> <outdir>: the board's first screen (P2UX08) at 390x844, 320x568 and 1280x900.
// Fails on console errors, horizontal overflow, a task id anywhere in the rendered text, buttons under 44 px, the brief not on
// top, or not three decisions; at 390x844 all three decisions and their buttons must be on the first screen.
import { createRequire } from 'module'; import fs from 'fs';
const require = createRequire('/scratch/ch29576/tools/webcheck/');
const { chromium } = require('playwright-core');
const [base, out] = process.argv.slice(2); fs.mkdirSync(out, { recursive: true });
const b = await chromium.launch({ executablePath: '/scratch/ch29576/tools/webcheck/browsers/chromium-1234/chrome-linux64/chrome', args: ['--no-sandbox'] });
let bad = 0;
for (const [w, h] of [[390, 844], [320, 568], [1280, 900]]) {
  const ctx = await b.newContext({ viewport: { width: w, height: h }, deviceScaleFactor: 2, isMobile: w < 800, hasTouch: w < 800 });
  const page = await ctx.newPage(); const errs = [];
  page.on('console', (m) => { if (m.type() === 'error') errs.push(m.text()); }); page.on('pageerror', (e) => errs.push(String(e)));
  await page.goto(base + '?t=' + Date.now()); await page.waitForFunction(() => document.querySelector('#brief')?.dataset.painted && document.querySelector('#lanes li'), null, { timeout: 20000 });
  await page.waitForTimeout(800);
  await page.screenshot({ path: `${out}/first_${w}x${h}.png` });
  await page.screenshot({ path: `${out}/full_${w}.png`, fullPage: true });
  const r = await page.evaluate(() => {
    const cards = [...document.querySelectorAll('.bdec')];
    const firstScreen = cards.filter((c) => { const bb = c.querySelector('.bbtns').getBoundingClientRect(); return bb.bottom <= innerHeight; }).length;
    const lastBtn = cards.length ? cards[cards.length - 1].querySelector('.bbtns').getBoundingClientRect().bottom : 0;
    const text = document.body.innerText;
    const ids = text.match(/P[0-9][A-Za-z]+[0-9]+_\S*/g) || [];
    const over = document.documentElement.scrollWidth > innerWidth + 1;
    const studioTop = document.querySelector('#studio-h').getBoundingClientRect().top, briefTop = document.querySelector('#brief').getBoundingClientRect().top;
    const small = [...document.querySelectorAll('.bbtns button')].filter((x) => x.getBoundingClientRect().height < 44).length;
    return { cards: cards.length, cardsWithButtonsOnFirstScreen: firstScreen, lastButtonsBottom: Math.round(lastBtn), ids, over, briefAboveStudio: briefTop < studioTop, smallButtons: small,
      lanes: [...document.querySelectorAll('#lanes .lane .what')].slice(0, 3).map((x) => x.innerText) };
  });
  console.log(JSON.stringify({ size: `${w}x${h}`, ...r, errs }));
  if (r.ids.length || r.over || errs.length || !r.briefAboveStudio || r.smallButtons || r.cards !== 3) bad++;
  if (w === 390 && r.cardsWithButtonsOnFirstScreen < 3) { console.log('FAIL 390: not all three decisions with buttons fit the first screen'); bad++; }
  await ctx.close();
}
await b.close(); console.log(bad ? `FAIL ${bad}` : 'PASS'); process.exit(bad ? 1 : 0);
