// record.cjs <html> <outDir> <actions.cjs> [W=1234] [H=673]
// Nimmt eine HTML-Seite (Nachbau) per Playwright als Video auf, mit einer Interaktions-Choreografie.
// actions.cjs:  module.exports = async (page, { sleep }) => { await sleep(400); await page.mouse.move(600,300); ... }
// Ausgabe: <outDir>/replica.webm   -> danach: frames.sh <outDir>/replica.webm <outDir>/r <fps> W:H:0:0  (Crop = ganze Flaeche, z.B. 1234:673:0:0)
const { chromium } = require('playwright');
const path = require('path'), fs = require('fs');
(async () => {
  const [, , html, outDir, actions, W = '1234', H = '673'] = process.argv;
  const w = +W, h = +H;
  fs.mkdirSync(outDir, { recursive: true });
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: w, height: h }, deviceScaleFactor: 1,
    recordVideo: { dir: outDir, size: { width: w, height: h } } });
  const page = await ctx.newPage();
  await page.goto('file://' + path.resolve(html));
  const sleep = (ms) => new Promise(r => setTimeout(r, ms));
  const act = require(path.resolve(actions));
  try { await act(page, { sleep }); } finally {
    const v = page.video(); await ctx.close();
    const p = await v.path(); fs.renameSync(p, path.join(outDir, 'replica.webm'));
    await browser.close();
  }
  console.log('OK ->', path.join(outDir, 'replica.webm'));
})().catch(e => { console.error(e); process.exit(1); });
