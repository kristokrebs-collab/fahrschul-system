/** Opens the standalone files from file:// with every non-file request blocked
 *  and actually uses them: answers the finder, types into the calculator,
 *  scrolls the route and the cockpit, and checks the video is playing. */
import { chromium } from '@playwright/test'
const DIR = process.argv[2]
const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' })
const p = await b.newPage({ viewport: { width: 1440, height: 900 } })
const errs = [], ext = []
p.on('console', m => { if (m.type() === 'error') errs.push(m.text().slice(0, 160)) })
p.on('pageerror', e => errs.push('PAGEERROR: ' + e.message.slice(0, 200)))
await p.route('**', r => {
  const u = r.request().url()
  if (!u.startsWith('file://') && !u.startsWith('data:') && !u.startsWith('blob:')) { ext.push(u.slice(0,70)); return r.abort() }
  return r.continue()
})
const out = {}
await p.goto(`file://${DIR}/index.html`, { waitUntil: 'load' })
await p.waitForTimeout(2500)

out.title = await p.title()
out.fonts = await p.evaluate(() => document.fonts.check('800 48px Archivo'))
out.h1 = (await p.locator('h1').first().innerText()).replace(/\s+/g,' ')

// ROUTE: does the canvas actually paint?
out.route = await p.evaluate(() => {
  const c = document.getElementById('route')
  if (!c || !c.width) return 'no canvas'
  const g = c.getContext('2d')
  const d = g.getImageData(Math.floor(c.width/2), Math.floor(c.height*0.62), 1, 1).data
  return { w: c.width, painted: d[3] > 0, px: [d[0],d[1],d[2],d[3]] }
})

// FINDER: answer every question, expect a recommendation
await p.locator('#finder').scrollIntoViewIfNeeded()
await p.waitForTimeout(600)
let steps = 0
while (steps < 8) {
  const opt = p.locator('#finder .opt').first()
  if (!(await opt.count())) break
  await opt.click(); steps++
  await p.waitForTimeout(260)
}
out.finder = { steps, result: (await p.locator('#finder h3').first().innerText().catch(()=>'')).slice(0,40) }

// CALCULATOR: type two prices, expect a computed difference
await p.locator('#rechner').scrollIntoViewIfNeeded()
await p.waitForTimeout(500)
const v0 = await p.evaluate(() => window.KREBS.prices.variants[0])
// Two real offers on the same quantities: 2.400 € vs 2.000 € of driving lessons
await p.fill(`#a-${v0.slug}-grundbetrag`, '350')
await p.fill(`#b-${v0.slug}-grundbetrag`, '290')
await p.fill(`#a-${v0.slug}-fahrstunde`, '62,50')
await p.fill(`#b-${v0.slug}-fahrstunde`, '69,00')
await p.waitForTimeout(400)
out.calc = await p.evaluate((slug) => ({
  lessonQty: document.querySelector('#q-' + slug + '-fahrstunde').value,
  lessonSumA: document.querySelector('#sa-' + slug + '-fahrstunde').textContent,
  totalA: document.querySelector('#panel-calc-' + slug + ' [data-total-a]').textContent,
  totalB: document.querySelector('#panel-calc-' + slug + ' [data-total-b]').textContent,
  verdict: document.querySelector('#panel-calc-' + slug + ' [data-verdict]').textContent.slice(0, 90),
}), v0.slug)

// TABS
const tabs = p.locator('.tab')
if (await tabs.count() > 1) { await tabs.nth(1).click(); await p.waitForTimeout(400) }
out.tabs = await p.evaluate(() => {
  const sel = [...document.querySelectorAll('.tab')].findIndex(t => t.getAttribute('aria-selected') === 'true')
  const shown = [...document.querySelectorAll('[role=tabpanel]')].filter(x => !x.hidden).length
  return { selected: sel, panelsShown: shown }
})

// COCKPIT: scroll through it and watch the app move
const ck = await p.evaluate(() => { const e = document.querySelector('.cockpit'); const r = e.getBoundingClientRect(); return r.top + scrollY })
await p.evaluate(y => scrollTo(0, y + 900), ck)
await p.waitForTimeout(900)
const t1 = await p.evaluate(() => getComputedStyle(document.querySelector('.phone-scroll')).transform)
await p.evaluate(y => scrollTo(0, y + 2400), ck)
await p.waitForTimeout(900)
const t2 = await p.evaluate(() => getComputedStyle(document.querySelector('.phone-scroll')).transform)
out.cockpit = { moved: t1 !== t2, t1: t1.slice(0,34), t2: t2.slice(0,34) }

// VIDEO
out.video = await p.evaluate(() => [...document.querySelectorAll('video')].map(v => ({
  playing: !v.paused && v.currentTime > 0, ready: v.readyState, w: v.videoWidth })).filter(v => v.ready > 0).length)

out.externalRequests = ext.length
out.errors = errs.slice(0, 6)
console.log(JSON.stringify(out, null, 1))
await b.close()
