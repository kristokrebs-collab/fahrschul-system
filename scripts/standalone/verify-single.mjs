/**
 * Exercises the single-file build from file:// with every non-local request
 * aborted: navigates the whole site, uses the widgets on the pages that have
 * them, comes back, and checks the runtime is still alive after all of it.
 *
 * Usage: node scripts/standalone/verify-single.mjs <file.html>
 */
import { chromium } from '@playwright/test'

const FILE = process.argv[2]
const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' })
const p = await browser.newPage({ viewport: { width: 1440, height: 900 } })

const errors = []
const external = []
p.on('console', (m) => m.type() === 'error' && errors.push(m.text().slice(0, 160)))
p.on('pageerror', (e) => errors.push('PAGEERROR ' + e.message.slice(0, 160)))
await p.route('**', (r) => {
  const u = r.request().url()
  if (!/^(file|data|blob):/.test(u)) { external.push(u.slice(0, 60)); return r.abort() }
  return r.continue()
})

const out = {}
await p.goto(`file://${FILE}`, { waitUntil: 'load' })
await p.waitForTimeout(2500)

out.start = await p.evaluate(() => ({ hash: location.hash, title: document.title, h1: document.querySelector('h1')?.textContent.replace(/\s+/g, ' ').slice(0, 40) }))
out.pages = await p.evaluate(() => Object.keys(PAGES).length)

// The route paints
out.route = await p.evaluate(() => {
  const c = document.getElementById('route')
  const d = c.getContext('2d').getImageData(Math.floor(c.width / 2), Math.floor(c.height * 0.62), 1, 1).data
  return { w: c.width, painted: d[3] > 0 }
})

// Media actually rehydrated — no index left behind
out.media = await p.evaluate(() => ({
  placeholders: document.querySelectorAll('[data-uri-src],[data-uri-poster],[data-uri-href],[data-uri-datasrc]').length,
  videoSources: [...document.querySelectorAll('video')].filter((v) => (v.getAttribute('data-src') || '').startsWith('data:')).length,
  images: [...document.querySelectorAll('img')].filter((i) => i.src.startsWith('data:')).length,
}))

// Finder on the homepage
await p.locator('#finder').scrollIntoViewIfNeeded()
await p.waitForTimeout(500)
let steps = 0
while (steps < 8) {
  const o = p.locator('#finder .opt').first()
  if (!(await o.count())) break
  await o.click(); steps++
  await p.waitForTimeout(220)
}
out.finder = { steps, result: await p.locator('#finder h3').first().innerText().catch(() => '') }

// Calculator on the homepage
await p.locator('#rechner').scrollIntoViewIfNeeded()
await p.waitForTimeout(400)
const slug = await p.evaluate(() => window.KREBS.prices.variants[0].slug)
await p.fill(`#a-${slug}-fahrstunde`, '62,50')
await p.fill(`#b-${slug}-fahrstunde`, '69,00')
await p.waitForTimeout(400)
out.calc = await p.evaluate((s) => document.querySelector('#panel-calc-' + s + ' [data-verdict]').textContent.slice(0, 60), slug)

// Walk every page in the file
const routes = await p.evaluate(() => Object.keys(PAGES))
const bad = []
for (const r of routes) {
  const before = errors.length
  await p.evaluate((h) => { location.hash = '#/' + h }, r)
  await p.waitForTimeout(320)
  const state = await p.evaluate(() => ({
    h1: (document.querySelector('h1')?.textContent ?? '').trim().length,
    title: document.title.length,
    placeholders: document.querySelectorAll('[data-uri-src],[data-uri-poster],[data-uri-href],[data-uri-datasrc]').length,
    stray: document.querySelectorAll('#app *').length,
  }))
  if (!state.h1 || !state.title || state.placeholders || errors.length > before) {
    bad.push({ route: r, ...state, newErrors: errors.slice(before, before + 2) })
  }
}
out.walk = { routes: routes.length, broken: bad }

// A link inside the document, clicked like a visitor would
await p.evaluate(() => { location.hash = '#/index' })
await p.waitForTimeout(500)
await p.locator('a[href="#/preise"]').first().click()
await p.waitForTimeout(600)
out.linkClick = await p.evaluate(() => ({ hash: location.hash, h1: document.querySelector('h1')?.textContent.slice(0, 30) }))

// Back button
await p.goBack()
await p.waitForTimeout(600)
out.back = await p.evaluate(() => ({ hash: location.hash, h1: document.querySelector('h1')?.textContent.slice(0, 30) }))

// …and after all that traffic the homepage widgets still have to work
await p.evaluate(() => { location.hash = '#/index' })
await p.waitForTimeout(700)
await p.locator('#finder').scrollIntoViewIfNeeded()
await p.waitForTimeout(400)
let again = 0
while (again < 8) {
  const o = p.locator('#finder .opt').first()
  if (!(await o.count())) break
  await o.click(); again++
  await p.waitForTimeout(200)
}
out.finderAfterWalk = { steps: again, result: await p.locator('#finder h3').first().innerText().catch(() => '') }
out.cockpitAfterWalk = await (async () => {
  const top = await p.evaluate(() => document.querySelector('.cockpit').getBoundingClientRect().top + scrollY)
  await p.evaluate((y) => scrollTo(0, y + 900), top)
  await p.waitForTimeout(800)
  const a = await p.evaluate(() => getComputedStyle(document.querySelector('.phone-scroll')).transform)
  await p.evaluate((y) => scrollTo(0, y + 2400), top)
  await p.waitForTimeout(800)
  const b = await p.evaluate(() => getComputedStyle(document.querySelector('.phone-scroll')).transform)
  return { moved: a !== b }
})()

out.videosPlaying = await p.evaluate(() => [...document.querySelectorAll('video')].filter((v) => !v.paused && v.currentTime > 0).length)
out.externalRequests = external.length
out.errors = errors.slice(0, 6)

console.log(JSON.stringify(out, null, 1))
await browser.close()
