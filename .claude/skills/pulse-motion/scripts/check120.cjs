// check120.cjs <html> <actions.cjs> [W=1234] [H=673]
// 120-Hz-Pruefung eines Nachbaus: (1) statische Anti-Muster-Suche, (2) Laufzeit-Messung der Frame-Zeiten
// waehrend der Choreografie (gleiche actions.cjs wie bei record.cjs), einmal normal und einmal mit 4x gedrosselter CPU
// (grobe Handy-Simulation). Ziel: Frame-Budget bei 120 Hz = 8.33 ms, bei 144 Hz = 6.94 ms, bei 240 Hz = 4.17 ms.
// Exit-Code 0 = bestanden, 1 = harte Verstoesse (FAIL). Warnungen (WARN) sind Hinweise.
const { chromium } = require('playwright');
const path = require('path'), fs = require('fs');

const BUDGET = 1000 / 120;

function lint(src) {
  const out = [];
  const add = (lvl, msg) => out.push({ lvl, msg });
  const code = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/<!--[\s\S]*?-->/g, '');
  if (/setInterval\s*\(/.test(code)) add('FAIL', 'setInterval gefunden: Animationen per requestAnimationFrame + Zeitstempel treiben, nicht per Intervall (60-Hz-Annahme).');
  if (/setTimeout\s*\([^)]*,\s*(8|16|17|33|1000\s*\/\s*60)\s*\)/.test(code)) add('FAIL', 'setTimeout mit ~Frame-Dauer (8/16/17/33 ms) als Animationstakt.');
  if (/1000\s*\/\s*60|16\.6+\d*\b|0\.016\d*\b|\/\s*60\s*\)\s*;?\s*\/\/\s*dt/i.test(code)) add('FAIL', 'Feste 60-fps-Annahme (1000/60, 16.67, 0.016) im Code - dt aus dem rAF-Zeitstempel berechnen.');
  if (/transition\s*:\s*all\b/.test(code)) add('FAIL', '"transition: all" - nur transform/opacity/filter (und konkrete Eigenschaften) animieren.');
  const layoutProp = /(width|height|top|left|right|bottom|margin[\w-]*|padding[\w-]*|border[\w-]*|box-shadow|font-size|line-height|letter-spacing)/;
  for (const m of code.matchAll(/transition\s*:\s*([^;}]+)/g)) {
    if (layoutProp.test(m[1].replace(/background[\w-]*/g, ''))) add('WARN', `transition auf Layout-/Paint-Eigenschaft: "${m[1].trim().slice(0, 70)}" - bei 120 Hz teuer, nach Moeglichkeit transform/opacity.`);
  }
  for (const m of code.matchAll(/@keyframes[^{]*\{([\s\S]*?)\}\s*\}/g)) {
    if (/(^|[;{\s])(width|height|top|left|right|bottom|margin[\w-]*|padding[\w-]*)\s*:/.test(m[1])) add('WARN', '@keyframes animiert Layout-Eigenschaften (width/height/top/left/margin/padding) - lieber transform.');
  }
  if (/\.style\.(left|top|right|bottom|width|height|margin\w*)\s*=/.test(code)) add('WARN', 'JS schreibt Layout-Eigenschaften (style.left/top/width/height) - bei Animation transform: translate3d()/scale() verwenden.');
  const rafs = [...code.matchAll(/requestAnimationFrame\s*\(\s*(\(?\s*\)?\s*=>|function\s*\(\s*\))/g)];
  if (rafs.length) add('WARN', 'requestAnimationFrame-Callback ohne Zeitstempel-Parameter - dt/Zeit muss aus dem rAF-Zeitstempel (oder performance.now()) kommen.');
  if (/requestAnimationFrame/.test(code) && !/performance\.now\(\)|\(\s*(t|ts|time|now|timestamp)\s*\)\s*=>|function\s*\w*\s*\(\s*(t|ts|time|now|timestamp)\s*\)/.test(code)) add('FAIL', 'requestAnimationFrame ohne erkennbare Zeitbasis (timestamp/performance.now) - Animation waere bildratenabhaengig.');
  if (!/prefers-reduced-motion/.test(code)) add('WARN', 'prefers-reduced-motion wird nicht beachtet.');
  if (!/will-change|translate3d|translateZ|contain\s*:/.test(code)) add('INFO', 'Kein will-change/translate3d/contain - animierte Elemente ggf. auf eigene Compositor-Ebene heben.');
  if (/backdrop-filter/.test(code)) add('INFO', 'backdrop-filter ist bei 120 Hz teuer - Flaeche klein halten, nicht auf Vollbild animieren.');
  if (/pointermove/.test(code) && !/getCoalescedEvents|requestAnimationFrame/.test(code)) add('WARN', 'pointermove ohne rAF-Batching/Coalesced-Events - bei 120+ Hz Eingabe pro Frame nur einmal verarbeiten.');
  if (/getBoundingClientRect|offsetWidth|offsetHeight|getComputedStyle/.test(code) && /requestAnimationFrame/.test(code)) add('INFO', 'Layout-Lesezugriffe (getBoundingClientRect/offset*/getComputedStyle) vorhanden - nicht pro Frame lesen, Werte cachen.');
  return out;
}

const pct = (a, p) => { const s = [...a].sort((x, y) => x - y); return s.length ? s[Math.min(s.length - 1, Math.floor(p * s.length))] : 0; };

async function run(html, actions, w, h, throttle) {
  const browser = await chromium.launch({ args: ['--disable-frame-rate-limit', '--disable-gpu-vsync'] });
  const ctx = await browser.newContext({ viewport: { width: w, height: h }, deviceScaleFactor: 1 });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
  page.on('console', (m) => { if (m.type() === 'error') errors.push('console.error: ' + m.text()); });
  await page.addInitScript(() => {
    window.__ft = []; window.__on = false;
    // Dummy-Layer: erzwingt pro rAF einen Compositor-Frame, damit auch Leerlauf-Phasen ungedrosselt rendern
    // (Headless-Chromium taktet sonst im Leerlauf mit 60 Hz und verfaelscht die Frame-Zeit-Statistik).
    let dummy = null, n = 0;
    const mk = () => { dummy = document.createElement('div'); dummy.style.cssText = 'position:fixed;left:0;top:0;width:1px;height:1px;opacity:.01;pointer-events:none;will-change:transform'; document.documentElement.appendChild(dummy); };
    const loop = (t) => { if (!dummy && document.documentElement) mk(); if (dummy) dummy.style.transform = 'translate3d(' + (++n % 2) + 'px,0,0)'; if (window.__on) window.__ft.push(t); requestAnimationFrame(loop); };
    requestAnimationFrame(loop);
  });
  await page.goto('file://' + path.resolve(html));
  const cdp = await ctx.newCDPSession(page);
  await cdp.send('Performance.enable');
  if (throttle > 1) await cdp.send('Emulation.setCPUThrottlingRate', { rate: throttle });
  const metrics = async () => Object.fromEntries((await cdp.send('Performance.getMetrics')).metrics.map((m) => [m.name, m.value]));
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  await sleep(300);
  const m0 = await metrics();
  const t0 = Date.now();
  await page.evaluate(() => { window.__ft = []; window.__on = true; });
  await require(path.resolve(actions))(page, { sleep });
  const secs = (Date.now() - t0) / 1000;
  const ft = await page.evaluate(() => { window.__on = false; return window.__ft; });
  const m1 = await metrics();
  await browser.close();
  const dts = []; for (let i = 1; i < ft.length; i++) dts.push(ft[i] - ft[i - 1]);
  const frames = ft.length;
  const d = (k) => (m1[k] || 0) - (m0[k] || 0);
  return {
    throttle, secs: +secs.toFixed(2), frames, fps_avg: +(frames / secs).toFixed(0),
    dt_p50_ms: +pct(dts, 0.5).toFixed(2), dt_p95_ms: +pct(dts, 0.95).toFixed(2), dt_p99_ms: +pct(dts, 0.99).toFixed(2), dt_max_ms: +Math.max(0, ...dts).toFixed(2),
    pct_over_budget: +(100 * dts.filter((x) => x > BUDGET * 1.25).length / Math.max(1, dts.length)).toFixed(1),
    script_ms_per_frame: +(1000 * d('ScriptDuration') / Math.max(1, frames)).toFixed(3),
    layout_ms_per_frame: +(1000 * d('LayoutDuration') / Math.max(1, frames)).toFixed(3),
    layouts_per_frame: +(d('LayoutCount') / Math.max(1, frames)).toFixed(2),
    style_recalcs_per_frame: +(d('RecalcStyleCount') / Math.max(1, frames)).toFixed(2),
    errors,
  };
}

(async () => {
  const [, , html, actions, W = '1234', H = '673'] = process.argv;
  const src = fs.readFileSync(html, 'utf8');
  const findings = lint(src);
  const runs = [await run(html, actions, +W, +H, 1), await run(html, actions, +W, +H, 4)];
  const fails = findings.filter((f) => f.lvl === 'FAIL').length;
  const errs = runs.flatMap((r) => r.errors);
  const slow = runs[1];
  // 4x-gedrosselt (Handy-Naehe): p95 Frame <= 8.33 ms*1.25 und Script <= 2.5 ms/Frame
  const perfOk = slow.dt_p95_ms <= BUDGET * 1.25 && slow.script_ms_per_frame <= 2.5;
  console.log('=== STATISCH ==='); findings.forEach((f) => console.log(`[${f.lvl}] ${f.msg}`)); if (!findings.length) console.log('keine Auffaelligkeiten');
  console.log('=== LAUFZEIT (Frame-Budget 120 Hz = 8.33 ms; Headless/Software-Raster, Vsync aus) ===');
  runs.forEach((r) => console.log(JSON.stringify(r)));
  if (errs.length) { console.log('=== KONSOLENFEHLER ==='); errs.forEach((e) => console.log(e)); }
  console.log(`VERDIKT 120Hz: statisch=${fails ? 'FAIL' : 'ok'}  laufzeit(4x CPU)=${perfOk ? 'ok' : 'ZU LANGSAM'}  fehler=${errs.length ? 'JA' : 'keine'}`);
  process.exit(fails || errs.length ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(2); });
