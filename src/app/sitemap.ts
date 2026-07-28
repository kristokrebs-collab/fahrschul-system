import type { MetadataRoute } from 'next'
import { business, locations } from '@/content/business'
import { licenceClasses } from '@/content/classes'
import { services } from '@/content/services'

/**
 * Sitemap generated from the content layer, so a new class or service is listed
 * the moment it is added — there is no second list to keep in sync.
 */
export default function sitemap(): MetadataRoute.Sitemap {
  const now = new Date()
  const url = (path: string) => `${business.siteUrl}${path}`

  const staticPages: Array<[string, number, MetadataRoute.Sitemap[number]['changeFrequency']]> = [
    ['/', 1, 'weekly'],
    ['/fuehrerschein', 0.9, 'monthly'],
    ['/leistungen', 0.8, 'monthly'],
    ['/preise', 0.8, 'monthly'],
    ['/ausbildungsablauf', 0.7, 'monthly'],
    ['/digitalpaket', 0.6, 'monthly'],
    ['/simulator', 0.6, 'monthly'],
    ['/schueler-cockpit', 0.5, 'monthly'],
    ['/team', 0.5, 'yearly'],
    ['/kontakt', 0.7, 'yearly'],
    ['/impressum', 0.1, 'yearly'],
    ['/datenschutz', 0.1, 'yearly'],
  ]

  return [
    ...staticPages.map(([path, priority, changeFrequency]) => ({
      url: url(path),
      lastModified: now,
      changeFrequency,
      priority,
    })),
    ...licenceClasses.map((c) => ({
      url: url(`/fuehrerschein/${c.slug}`),
      lastModified: now,
      changeFrequency: 'monthly' as const,
      priority: 0.8,
    })),
    ...services.map((s) => ({
      url: url(`/leistungen/${s.slug}`),
      lastModified: now,
      changeFrequency: 'monthly' as const,
      priority: 0.7,
    })),
    ...locations.map((l) => ({
      url: url(`/standorte/${l.slug}`),
      lastModified: now,
      changeFrequency: 'monthly' as const,
      priority: 0.8,
    })),
  ]
}
