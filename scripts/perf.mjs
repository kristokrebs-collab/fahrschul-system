/**
 * Lightweight field-style performance probe: measures LCP, CLS and transferred
 * bytes on a cold load, with CPU and network throttling to approximate a
 * mid-range phone. Not a substitute for Lighthouse, but it runs anywhere.
 */
import { chromium } from '@playwright/test'

const [, , url = 'http://127.0.0.1:3100/'] = process.argv
const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' })
const page = await browser.newPage({ viewport: { width: 390, height: 844 } })
const client = await page.context().newCDPSession(page)
await client.send('Network.enable')
await client.send('Emulation.setCPUThrottlingRate', { rate: 4 })
await client.send('Network.emulateNetworkConditions', {
  offline: false, latency: 150, downloadThroughput: (1.6 * 1024 * 1024) / 8, uploadThroughput: (750 * 1024) / 8,
})

let bytes = 0
const byType = {}
page.on('response', async (r) => {
  try {
    const len = Number(r.headers()['content-length'] || 0)
    bytes += len
    const t = r.request().resourceType()
    byType[t] = (byType[t] || 0) + len
  } catch {}
})

await page.goto(url, { waitUntil: 'load', timeout: 90000 })
await page.waitForTimeout(3500)

const vitals = await page.evaluate(() => new Promise((resolve) => {
  const out = { lcp: 0, cls: 0 }
  new PerformanceObserver((l) => { for (const e of l.getEntries()) out.lcp = Math.round(e.startTime) }).observe({ type: 'largest-contentful-paint', buffered: true })
  new PerformanceObserver((l) => { for (const e of l.getEntries()) if (!e.hadRecentInput) out.cls += e.value }).observe({ type: 'layout-shift', buffered: true })
  const nav = performance.getEntriesByType('navigation')[0]
  const fcp = performance.getEntriesByName('first-contentful-paint')[0]
  setTimeout(() => resolve({ ...out, cls: Number(out.cls.toFixed(4)), fcp: fcp ? Math.round(fcp.startTime) : null, domContentLoaded: nav ? Math.round(nav.domContentLoadedEventEnd) : null }), 600)
}))

console.log(JSON.stringify({ url, ...vitals, transferredKB: Math.round(bytes / 1024), byTypeKB: Object.fromEntries(Object.entries(byType).map(([k, v]) => [k, Math.round(v / 1024)])) }, null, 1))
await browser.close()
