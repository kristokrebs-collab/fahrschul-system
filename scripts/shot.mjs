/**
 * Visual QA capture.
 *
 * Screenshots one or more scroll positions or elements of a page at a given
 * viewport, and reports any console, page or request errors it sees on the way.
 * Used for the visual review pass — see docs/visual-qa.md.
 *
 * Usage: node scripts/shot.mjs <url> <outPrefix> <width> <height> [full|sel:a|b|scroll:100,2000]
 */
import { chromium } from '@playwright/test'

const [, , url, out, w = '1440', h = '900', mode = ''] = process.argv

const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' })
const page = await browser.newPage({
  viewport: { width: Number(w), height: Number(h) },
  deviceScaleFactor: 2,
})

const errors = []
page.on('console', (m) => {
  if (m.type() === 'error') errors.push(m.text())
})
page.on('pageerror', (e) => errors.push('PAGEERROR: ' + e.message))
page.on('requestfailed', (r) => errors.push('REQFAIL: ' + r.url() + ' ' + (r.failure()?.errorText ?? '')))

await page.goto(url, { waitUntil: 'networkidle', timeout: 60000 })
await page.waitForTimeout(900)

if (mode.startsWith('sel:')) {
  const selectors = mode.slice(4).split('|')
  for (const [i, sel] of selectors.entries()) {
    const el = page.locator(sel).first()
    if ((await el.count()) === 0) {
      console.log('MISSING SELECTOR:', sel)
      continue
    }
    await el.scrollIntoViewIfNeeded()
    await page.waitForTimeout(700)
    await el.screenshot({ path: `${out}-${i}.png` })
  }
} else if (mode.startsWith('scroll:')) {
  const positions = mode.slice(7).split(',').map(Number)
  for (const [i, y] of positions.entries()) {
    await page.evaluate((top) => window.scrollTo({ top, behavior: 'instant' }), y)
    await page.waitForTimeout(700)
    await page.screenshot({ path: `${out}-${i}.png` })
  }
} else {
  await page.screenshot({ path: `${out}.png`, fullPage: mode === 'full' })
}

console.log('PAGE HEIGHT:', await page.evaluate(() => document.documentElement.scrollHeight))
console.log('CONSOLE ERRORS:', errors.length ? JSON.stringify(errors, null, 1) : 'none')
await browser.close()
