/** Verifies the offline preview from file:// with all network blocked. */
import { chromium } from '@playwright/test'
const [, , dir] = process.argv
const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' })
const p = await b.newPage({ viewport: { width: 1440, height: 900 } })
const errs = [], ext = []
p.on('console', m => { if (m.type() === 'error') errs.push(m.text().slice(0, 120)) })
p.on('pageerror', e => errs.push('pageerror: ' + e.message.slice(0, 120)))
await p.route('**', r => {
  const u = r.request().url()
  if (!u.startsWith('file://') && !u.startsWith('data:')) { ext.push(u); return r.abort() }
  return r.continue()
})

await p.goto(`file://${dir}/index.html`, { waitUntil: 'load' })
await p.waitForTimeout(1200)

const out = {}
out.title = await p.title()
out.bodyBg = await p.evaluate(() => getComputedStyle(document.body).backgroundColor)
// Proof the embedded webfont really rendered, not a fallback.
out.archivoLoaded = await p.evaluate(() => document.fonts.check('700 48px Archivo'))
out.instrumentLoaded = await p.evaluate(() => document.fonts.check('400 16px "Instrument Sans"'))
out.h1 = (await p.locator('h1').textContent()).replace(/\s+/g, ' ').trim()

// Navigate: home → class page → back to overview, using only real clicks.
await p.getByRole('link', { name: /Klasse B ansehen/ }).first().click()
await p.waitForTimeout(600)
out.afterNav = { url: p.url().split('/').pop(), h1: (await p.locator('h1').textContent()).trim() }
out.classPageHasLegalFacts = (await p.locator('body').textContent()).includes('Sonderfahrten')

await p.goto(`file://${dir}/preise.html`, { waitUntil: 'load' })
await p.waitForTimeout(500)
out.calculatorRendered = await p.getByRole('table').isVisible()

await p.goto(`file://${dir}/schueler-cockpit.html`, { waitUntil: 'load' })
await p.waitForTimeout(500)
out.cockpitStates = await p.locator('h3').count()

console.log(JSON.stringify({ ...out, externalRequests: ext.length, errors: errs }, null, 1))
await b.close()
