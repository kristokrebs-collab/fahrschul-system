import type { Metadata } from 'next'
import { business, locations } from '@/content/business'
import { publicValue } from '@/content/truth'
import { PageHeader } from '@/components/brand/page-header'

export const metadata: Metadata = {
  title: 'Impressum',
  description: 'Impressum und Anbieterkennzeichnung der Fahrschule Krebs GmbH.',
  alternates: { canonical: '/impressum' },
  robots: { index: true, follow: false },
}

export default function ImprintPage() {
  const main = locations[0]!
  const street = publicValue(main.street)
  const postal = publicValue(main.postalCode)
  const phone = publicValue(main.phone)
  const email = publicValue(main.email)
  const director = publicValue(business.managingDirector)
  const register = publicValue(business.register)
  const vat = publicValue(business.vatId)
  const authority = publicValue(business.supervisoryAuthority)

  return (
    <>
      <PageHeader
        eyebrow="Rechtliches"
        title="Impressum"
        trail={[{ name: 'Start', href: '/' }, { name: 'Impressum', href: '/impressum' }]}
      />

      <div className="shell-narrow space-y-10 pb-24 text-[0.9375rem] leading-relaxed text-chalk-soft">
        <section>
          <h2 className="font-display text-xl font-bold text-chalk">Angaben gemäß § 5 DDG</h2>
          <address className="mt-4 not-italic">
            {business.legalName}
            {street && postal && (
              <>
                <br />
                {street}
                <br />
                {postal} {main.city}
              </>
            )}
          </address>
        </section>

        {director && (
          <section>
            <h2 className="font-display text-xl font-bold text-chalk">Vertreten durch</h2>
            <p className="mt-3">{director}, Geschäftsführer</p>
          </section>
        )}

        <section>
          <h2 className="font-display text-xl font-bold text-chalk">Kontakt</h2>
          <p className="mt-3">
            {phone && <>Telefon: {phone}<br /></>}
            {email && <>E-Mail: {email}</>}
          </p>
        </section>

        {register && (
          <section>
            <h2 className="font-display text-xl font-bold text-chalk">Registereintrag</h2>
            <p className="mt-3">{register}</p>
          </section>
        )}

        {vat && (
          <section>
            <h2 className="font-display text-xl font-bold text-chalk">Umsatzsteuer-Identifikationsnummer</h2>
            <p className="mt-3">{vat}</p>
          </section>
        )}

        {authority && (
          <section>
            <h2 className="font-display text-xl font-bold text-chalk">Zuständige Aufsichtsbehörde</h2>
            <p className="mt-3">{authority}</p>
            <p className="mt-2 text-sm text-chalk-dim">
              Berufsbezeichnung: Fahrlehrerin / Fahrlehrer, verliehen in der Bundesrepublik Deutschland. Es gelten das
              Fahrlehrergesetz (FahrlG) und die Fahrschüler-Ausbildungsordnung (FahrschAusbO).
            </p>
          </section>
        )}

        <section>
          <h2 className="font-display text-xl font-bold text-chalk">Verbraucherstreitbeilegung</h2>
          <p className="mt-3">
            Wir sind nicht bereit und nicht verpflichtet, an Streitbeilegungsverfahren vor einer
            Verbraucherschlichtungsstelle teilzunehmen.
          </p>
        </section>

        <section className="rounded-xl border border-amber-500/25 bg-amber-500/[0.06] p-5">
          <h2 className="font-display text-base font-bold text-amber-400">Hinweis zur Fertigstellung</h2>
          <p className="mt-2 text-sm leading-relaxed text-chalk-dim">
            Diese Seite ist aus öffentlich zugänglichen Angaben zusammengestellt und muss vor dem Livegang vom
            Unternehmen geprüft und freigegeben werden — insbesondere Umsatzsteuer-Identifikationsnummer, zuständige
            Aufsichtsbehörde und die vollständige Vertretungsregelung.
          </p>
        </section>
      </div>
    </>
  )
}
