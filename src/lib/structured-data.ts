import { business, locations, type Location } from '@/content/business'
import { publicValue } from '@/content/truth'
import type { LicenceClass } from '@/content/classes'

/**
 * Structured data is generated from the same content layer the page renders,
 * and every field goes through `publicValue()`. A fact that is too uncertain to
 * show a visitor is therefore also too uncertain to hand to a search engine —
 * which is exactly the property you want, because schema markup that
 * contradicts the visible page is a ranking liability, not an asset.
 */

type JsonLd = Record<string, unknown>

function locationNode(location: Location): JsonLd | null {
  const street = publicValue(location.street)
  const postal = publicValue(location.postalCode)
  if (!street || !postal) return null

  const phone = publicValue(location.phoneHref)
  const email = publicValue(location.email)
  const hours = publicValue(location.officeHours)

  const node: JsonLd = {
    '@type': 'DrivingSchool',
    '@id': `${business.siteUrl}/standorte/${location.slug}#business`,
    name: `${business.legalName} — ${location.name}`,
    address: {
      '@type': 'PostalAddress',
      streetAddress: street,
      postalCode: postal,
      addressLocality: location.city,
      addressRegion: 'Hessen',
      addressCountry: 'DE',
    },
    url: `${business.siteUrl}/standorte/${location.slug}`,
  }

  if (phone) node.telephone = phone
  if (email) node.email = email

  // Only emit opening hours when we actually have them; an empty
  // openingHoursSpecification is worse than none at all.
  if (hours && hours.length > 0) {
    const mapped = hours
      .map((h) => mapHours(h.days, h.hours))
      .filter((v): v is JsonLd => v !== null)
    if (mapped.length > 0) node.openingHoursSpecification = mapped
  }

  return node
}

const DAY_MAP: Record<string, string[]> = {
  'Montag bis Donnerstag': ['Monday', 'Tuesday', 'Wednesday', 'Thursday'],
  'Montag bis Freitag': ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday'],
  Freitag: ['Friday'],
  Samstag: ['Saturday'],
}

function mapHours(days: string, hours: string): JsonLd | null {
  const dayOfWeek = DAY_MAP[days]
  if (!dayOfWeek) return null

  const match = hours.match(/(\d{1,2}):(\d{2})\s*[–-]\s*(\d{1,2}):(\d{2})/)
  if (!match) return null

  return {
    '@type': 'OpeningHoursSpecification',
    dayOfWeek,
    opens: `${match[1]!.padStart(2, '0')}:${match[2]}`,
    closes: `${match[3]!.padStart(2, '0')}:${match[4]}`,
  }
}

export function organizationJsonLd(): JsonLd {
  const nodes = locations.map(locationNode).filter((n): n is JsonLd => n !== null)

  return {
    '@context': 'https://schema.org',
    '@graph': [
      {
        '@type': 'Organization',
        '@id': `${business.siteUrl}#organization`,
        name: business.legalName,
        url: business.siteUrl,
        foundingDate: publicValue(business.founded)?.toString(),
        founder: publicValue(business.founder) ? { '@type': 'Person', name: publicValue(business.founder) } : undefined,
        sameAs: [business.social.facebookFulda, business.social.instagram],
        department: nodes.map((n) => ({ '@id': n['@id'] })),
      },
      ...nodes,
      {
        '@type': 'WebSite',
        '@id': `${business.siteUrl}#website`,
        url: business.siteUrl,
        name: business.shortName,
        inLanguage: 'de-DE',
        publisher: { '@id': `${business.siteUrl}#organization` },
      },
    ],
  }
}

export function courseJsonLd(licenceClass: LicenceClass): JsonLd {
  return {
    '@context': 'https://schema.org',
    '@type': 'Course',
    name: `Führerschein ${licenceClass.name}`,
    description: licenceClass.summary,
    url: `${business.siteUrl}/fuehrerschein/${licenceClass.slug}`,
    inLanguage: 'de-DE',
    provider: { '@type': 'Organization', name: business.legalName, url: business.siteUrl },
    // No `offers` node: we publish no prices, so claiming one would be false.
    hasCourseInstance: locations
      .map((l) => {
        const city = publicValue(l.postalCode) ? l.city : null
        if (!city) return null
        return {
          '@type': 'CourseInstance',
          courseMode: 'onsite',
          location: { '@type': 'Place', name: `${business.shortName} ${l.name}`, address: { '@type': 'PostalAddress', addressLocality: city, addressCountry: 'DE' } },
        }
      })
      .filter(Boolean),
  }
}

export function breadcrumbJsonLd(trail: readonly { name: string; href: string }[]): JsonLd {
  return {
    '@context': 'https://schema.org',
    '@type': 'BreadcrumbList',
    itemListElement: trail.map((item, index) => ({
      '@type': 'ListItem',
      position: index + 1,
      name: item.name,
      item: `${business.siteUrl}${item.href}`,
    })),
  }
}

export function faqJsonLd(faqs: readonly { question: string; answer: string }[]): JsonLd {
  return {
    '@context': 'https://schema.org',
    '@type': 'FAQPage',
    mainEntity: faqs.map((f) => ({
      '@type': 'Question',
      name: f.question,
      acceptedAnswer: { '@type': 'Answer', text: f.answer },
    })),
  }
}
