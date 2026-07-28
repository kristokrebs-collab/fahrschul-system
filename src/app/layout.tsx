import type { Metadata, Viewport } from 'next'
import { Archivo, Instrument_Sans } from 'next/font/google'
import { SiteHeader } from '@/components/navigation/site-header'
import { SiteFooter } from '@/components/navigation/site-footer'
import { Atmosphere } from '@/components/brand/atmosphere'
import { ChapterAtmosphere } from '@/components/brand/chapter-atmosphere'
import { Daylight } from '@/components/brand/daylight'
import { HeadlightCursor } from '@/components/brand/headlight-cursor'
import { MotionPreferenceProbe } from '@/components/brand/motion-preference-probe'
import { business } from '@/content/business'
import { organizationJsonLd } from '@/lib/structured-data'
import './globals.css'

const archivo = Archivo({
  subsets: ['latin', 'latin-ext'],
  variable: '--font-archivo',
  display: 'swap',
  axes: ['wdth'],
})

const instrument = Instrument_Sans({
  subsets: ['latin', 'latin-ext'],
  variable: '--font-instrument',
  display: 'swap',
})

export const metadata: Metadata = {
  metadataBase: new URL(business.siteUrl),
  title: {
    default: `${business.legalName} — Fahrschule in Fulda und Bad Hersfeld`,
    template: `%s | ${business.shortName}`,
  },
  description:
    'Fahrschule Krebs bildet in Fulda und Bad Hersfeld in allen Führerscheinklassen aus — vom Roller bis zum Bus. Mit zwei Fahrsimulatoren, digitalem Schüler-Cockpit und transparenten Preisen.',
  applicationName: business.shortName,
  authors: [{ name: business.legalName }],
  generator: undefined,
  keywords: [
    'Fahrschule Fulda',
    'Fahrschule Bad Hersfeld',
    'Führerschein Fulda',
    'Führerschein Bad Hersfeld',
    'LKW Führerschein Osthessen',
    'Berufskraftfahrer Fulda',
  ],
  alternates: { canonical: '/' },
  openGraph: {
    type: 'website',
    locale: 'de_DE',
    url: business.siteUrl,
    siteName: business.shortName,
    title: `${business.legalName} — Fahrschule in Fulda und Bad Hersfeld`,
    description:
      'Alle Klassen, zwei Standorte, ein digitaler Weg. Führerscheinausbildung mit Simulator, Schüler-Cockpit und transparenten Preisen.',
  },
  twitter: {
    card: 'summary_large_image',
    title: `${business.legalName} — Fahrschule in Fulda und Bad Hersfeld`,
    description: 'Alle Klassen, zwei Standorte, ein digitaler Weg.',
  },
  robots: {
    index: true,
    follow: true,
    googleBot: { index: true, follow: true, 'max-image-preview': 'large', 'max-snippet': -1 },
  },
  formatDetection: { telephone: true, address: true, email: true },
}

export const viewport: Viewport = {
  themeColor: '#060708',
  colorScheme: 'dark',
  width: 'device-width',
  initialScale: 1,
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="de" className={`${archivo.variable} ${instrument.variable}`} suppressHydrationWarning>
      <body>
        <MotionPreferenceProbe />
        <a
          href="#inhalt"
          className="sr-only-focusable fixed left-4 top-4 z-[100] rounded-lg bg-signal-500 px-5 py-3 text-sm font-semibold text-chalk"
        >
          Zum Inhalt springen
        </a>
        <Daylight />
        <HeadlightCursor />
        <Atmosphere />
        <ChapterAtmosphere />
        <SiteHeader />
        <main id="inhalt" className="relative z-10">
          {children}
        </main>
        <SiteFooter />
        <script
          type="application/ld+json"
          // Structured data is built from the same content layer the page renders,
          // so it cannot drift from the visible facts.
          dangerouslySetInnerHTML={{ __html: JSON.stringify(organizationJsonLd()) }}
        />
      </body>
    </html>
  )
}
