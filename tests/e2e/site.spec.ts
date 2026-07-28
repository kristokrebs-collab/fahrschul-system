import { expect, test, type Page } from '@playwright/test'

/**
 * End-to-end coverage of the things a build passing cannot prove:
 * that the page renders without console errors, that the interactive tools
 * actually compute, that navigation is operable by keyboard, and that nothing
 * essential disappears under reduced motion.
 */

/** Fails the test if the page logged an error or failed a request. */
function watchForErrors(page: Page): string[] {
  const errors: string[] = []
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(m.text())
  })
  page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`))
  page.on('requestfailed', (r) => {
    // Only navigation aborts are benign (they happen when a test navigates
    // away mid-flight). An aborted stylesheet or script is a real failure and
    // must not be filtered out — that is exactly how a page that renders
    // completely unstyled slips through a green test run.
    if (r.resourceType() === 'document' && r.failure()?.errorText === 'net::ERR_ABORTED') return
    errors.push(`requestfailed: ${r.url()} ${r.failure()?.errorText ?? ''}`)
  })
  return errors
}

/**
 * Selects one option of the licence finder.
 *
 * The radio inputs are sr-only by design — the visible, clickable control is
 * the styled label wrapping each one — so this clicks the label, which is what
 * a real user does.
 */
async function pick(page: Page, name: string | RegExp) {
  const label = page.locator('label').filter({ has: page.getByRole('radio', { name }) }).first()
  await label.click()
}

const PAGES = [
  '/',
  '/fuehrerschein',
  '/fuehrerschein/klasse-b',
  '/fuehrerschein/bf17',
  '/fuehrerschein/d',
  '/leistungen',
  '/leistungen/bkf-weiterbildung',
  '/digitalpaket',
  '/simulator',
  '/schueler-cockpit',
  '/preise',
  '/ausbildungsablauf',
  '/standorte/fulda',
  '/standorte/bad-hersfeld',
  '/team',
  '/kontakt',
  '/impressum',
  '/datenschutz',
]

test.describe('pages render cleanly', () => {
  for (const path of PAGES) {
    test(`${path} has one h1, a title and no console errors`, async ({ page }) => {
      const errors = watchForErrors(page)
      const response = await page.goto(path)

      expect(response?.status(), `${path} should return 200`).toBe(200)
      await expect(page.locator('h1')).toHaveCount(1)
      await expect(page).toHaveTitle(/.+/)
      expect(errors, `${path} logged errors`).toEqual([])
    })
  }
})

test('404 page renders for an unknown route', async ({ page }) => {
  const response = await page.goto('/diese-seite-gibt-es-nicht')
  expect(response?.status()).toBe(404)
  await expect(page.getByRole('heading', { level: 1 })).toContainText('Falsch abgebogen')
})

test('sitemap and robots are served', async ({ request }) => {
  const sitemap = await request.get('/sitemap.xml')
  expect(sitemap.ok()).toBeTruthy()
  const body = await sitemap.text()
  expect(body).toContain('/fuehrerschein/klasse-b')
  expect(body).toContain('/standorte/bad-hersfeld')

  const robots = await request.get('/robots.txt')
  expect(robots.ok()).toBeTruthy()
  expect(await robots.text()).toContain('Sitemap:')
})

test.describe('price calculator', () => {
  test('computes a like-for-like comparison', async ({ page }) => {
    await page.goto('/preise')

    const table = page.getByRole('table')
    await expect(table).toBeVisible()

    // Grundbetrag: 399 vs 450, quantity fixed at 1.
    await page.getByLabel('Preis Grundbetrag, dein Angebot').fill('399');
    await page.getByLabel('Preis Grundbetrag, Vergleichsangebot').fill('450')

    // Fahrstunde: 64 vs 69 at the default quantity of 20.
    await page.getByLabel('Preis Übungsfahrstunde, dein Angebot').fill('64')
    await page.getByLabel('Preis Übungsfahrstunde, Vergleichsangebot').fill('69')

    // 399 + 1280 = 1679,00 € / 450 + 1380 = 1830,00 € / difference 151,00 €
    await expect(page.getByRole('row', { name: /Summe/ })).toContainText('1.679,00')
    await expect(page.getByRole('row', { name: /Summe/ })).toContainText('1.830,00')
    await expect(page.getByRole('row', { name: /Summe/ })).toContainText('151,00')
  })

  test('accepts German decimal input', async ({ page }) => {
    await page.goto('/preise')
    await page.getByLabel('Preis Grundbetrag, dein Angebot').fill('1.234,50')
    await expect(page.getByRole('row', { name: /Summe/ })).toContainText('1.234,50')
  })

  test('changing quantity changes the total', async ({ page }) => {
    await page.goto('/preise')
    await page.getByLabel('Preis Übungsfahrstunde, dein Angebot').fill('50')
    await expect(page.getByRole('row', { name: /Summe/ })).toContainText('1.000,00')

    await page.getByLabel('Menge Übungsfahrstunde').fill('10')
    await expect(page.getByRole('row', { name: /Summe/ })).toContainText('500,00')
  })

  test('warns when only one side of a line is priced', async ({ page }) => {
    await page.goto('/preise')
    await page.getByLabel('Preis Übungsfahrstunde, dein Angebot').fill('50')
    await expect(page.getByText(/nicht direkt vergleichbar/)).toBeVisible()
  })
})

test.describe('licence finder', () => {
  test('produces a recommendation and links to the class', async ({ page }) => {
    await page.goto('/fuehrerschein#finder')

    await pick(page, /^Auto/)
    await pick(page, '16 oder 17')
    await pick(page, 'Noch keine')
    await pick(page, 'Schaltung')
    await pick(page, 'Privat')
    await pick(page, 'Fulda')

    // Scoped to the finder: the full class list further down the same page
    // also links to every class, so an unscoped locator matches twice.
    const result = page.locator('#finder')
    await expect(result.getByText('Unsere Empfehlung')).toBeVisible()
    await expect(result.getByRole('heading', { name: 'Begleitetes Fahren ab 17' })).toBeVisible()
    await expect(result.getByRole('link', { name: /Begleitetes Fahren ab 17 ansehen/ })).toBeVisible()
  })

  test('recommends B197 for someone escaping an automatic restriction', async ({ page }) => {
    await page.goto('/fuehrerschein#finder')

    await pick(page, /^Auto/)
    await pick(page, '18 bis 20')
    await pick(page, 'Klasse B, nur Automatik')
    await pick(page, 'Noch unentschieden')
    await pick(page, 'Privat')
    await pick(page, 'Ist mir egal')

    await expect(page.locator('#finder').getByRole('heading', { name: /Schlüsselzahl 197/ })).toBeVisible()
  })
})

test.describe('contact form', () => {
  test('rejects invalid input server-side and keeps the user on the form', async ({ page }) => {
    await page.goto('/kontakt')

    await page.getByLabel('Name').fill('A')
    await page.getByLabel('E-Mail').fill('keine-mail')
    await page.getByLabel('Deine Nachricht').fill('kurz')
    await page.getByRole('button', { name: 'Anfrage senden' }).click()

    await expect(page.getByText('Bitte prüfe die markierten Felder.')).toBeVisible()
    await expect(page.getByText('Diese E-Mail-Adresse sieht nicht gültig aus.')).toBeVisible()
  })

  test('does not claim success when no delivery transport is configured', async ({ page }) => {
    await page.goto('/kontakt')

    await page.getByLabel('Name').fill('Testperson')
    await page.getByLabel('E-Mail').fill('test@example.org')
    await page.getByLabel('Deine Nachricht').fill('Ich interessiere mich für die Klasse B und hätte gern Informationen.')
    await page.getByRole('checkbox').check()
    await page.getByRole('button', { name: 'Anfrage senden' }).click()

    // A fake success toast is exactly what this must never do.
    await expect(page.getByText(/konnte deine Anfrage gerade nicht übermitteln/)).toBeVisible()
    await expect(page.getByText('Nachricht gesendet')).toHaveCount(0)
  })
})

test.describe('accessibility', () => {
  test('skip link is the first focusable element and works', async ({ page }) => {
    await page.goto('/')
    await page.keyboard.press('Tab')

    const skip = page.getByRole('link', { name: 'Zum Inhalt springen' })
    await expect(skip).toBeFocused()
    await skip.press('Enter')
    await expect(page.locator('#inhalt')).toBeVisible()
  })

  test('desktop navigation opens by keyboard and closes with Escape', async ({ page, isMobile }) => {
    test.skip(isMobile, 'desktop disclosure navigation only')
    await page.goto('/')

    const trigger = page.getByRole('button', { name: 'Führerschein' })
    await trigger.focus()
    await page.keyboard.press('Enter')
    await expect(trigger).toHaveAttribute('aria-expanded', 'true')
    await expect(page.getByRole('link', { name: /^Klasse B/ }).first()).toBeVisible()

    await page.keyboard.press('Escape')
    await expect(trigger).toHaveAttribute('aria-expanded', 'false')
  })

  test('licence lane tabs respond to arrow keys', async ({ page }) => {
    await page.goto('/fuehrerschein')
    const pkw = page.getByRole('tab', { name: /PKW/ })
    await pkw.click()
    await expect(pkw).toHaveAttribute('aria-selected', 'true')

    await pkw.press('ArrowRight')
    await expect(page.getByRole('tab', { name: /Zweirad/ })).toHaveAttribute('aria-selected', 'true')
  })

  test('every image-free page still exposes its main landmark', async ({ page }) => {
    await page.goto('/')
    await expect(page.getByRole('main')).toBeVisible()
    await expect(page.getByRole('contentinfo')).toBeAttached()
    await expect(page.getByRole('banner')).toBeVisible()
  })
})

test.describe('reduced motion', () => {
  test.use({ reducedMotion: 'reduce' })

  test('cockpit content remains complete and ordered', async ({ page }) => {
    await page.goto('/schueler-cockpit')

    // All six narrative passages must still be present and readable.
    for (const heading of [
      'Was heute ansteht',
      'Der ganze Weg auf einen Blick',
      'Rückmeldung nach jeder Fahrstunde',
      'Pflichtfahrten, exakt gezählt',
      'Papierkram ohne Rückfragen',
      'Bereit — und zwar nachvollziehbar',
    ]) {
      await expect(page.getByRole('heading', { name: heading })).toBeVisible()
    }
  })

  test('homepage still reaches the final call to action', async ({ page }) => {
    await page.goto('/')
    await expect(page.getByRole('heading', { name: /Der erste Schritt ist der kleinste/ })).toBeAttached()
  })
})

test.describe('mobile', () => {
  test.skip(({ isMobile }) => !isMobile, 'mobile-only behaviour')

  test('menu opens, traps scroll and navigates', async ({ page }) => {
    await page.goto('/')

    await page.getByRole('button', { name: 'Menü öffnen' }).click()
    const nav = page.getByRole('navigation', { name: 'Hauptnavigation mobil' })
    await expect(nav).toBeVisible()

    const overflow = await page.evaluate(() => document.body.style.overflow)
    expect(overflow).toBe('hidden')

    await nav.getByRole('link', { name: 'Klasse B', exact: true }).click()
    await expect(page).toHaveURL(/\/fuehrerschein\/klasse-b/)
    await expect(page.getByRole('heading', { level: 1 })).toContainText('Klasse B')
  })

  for (const path of ['/', '/preise', '/schueler-cockpit', '/fuehrerschein']) {
    test(`no horizontal overflow on ${path}`, async ({ page }) => {
      await page.goto(path)
      const result = await page.evaluate(() => {
        const doc = document.documentElement
        window.scrollTo(600, 0)
        const scrolled = window.scrollX
        window.scrollTo(0, 0)
        return { overflow: doc.scrollWidth - doc.clientWidth, scrolled }
      })
      expect(result.overflow, 'document should not be wider than the viewport').toBeLessThanOrEqual(1)
      expect(result.scrolled, 'page must not scroll sideways').toBe(0)
    })
  }

  test('the cockpit is shown full width, never inside a device frame', async ({ page }) => {
    await page.goto('/schueler-cockpit')
    // The sticky desktop device column is hidden below lg.
    await expect(page.locator('.sticky').first()).toBeHidden()
  })
})
