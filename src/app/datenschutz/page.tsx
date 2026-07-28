import type { Metadata } from 'next'
import { business, locations } from '@/content/business'
import { publicValue } from '@/content/truth'
import { PageHeader } from '@/components/brand/page-header'

export const metadata: Metadata = {
  title: 'Datenschutzerklärung',
  description: 'Informationen zur Verarbeitung personenbezogener Daten auf der Website der Fahrschule Krebs GmbH.',
  alternates: { canonical: '/datenschutz' },
  robots: { index: true, follow: false },
}

export default function PrivacyPage() {
  const main = locations[0]!
  const email = publicValue(main.email)
  const street = publicValue(main.street)
  const postal = publicValue(main.postalCode)

  return (
    <>
      <PageHeader
        eyebrow="Rechtliches"
        title="Datenschutz"
        lead="Diese Website kommt ohne Tracking, ohne Werbenetzwerke und ohne eingebettete Dienste Dritter aus. Es gibt deshalb auch kein Cookie-Banner."
        trail={[{ name: 'Start', href: '/' }, { name: 'Datenschutz', href: '/datenschutz' }]}
      />

      <div className="shell-narrow space-y-10 pb-24 text-[0.9375rem] leading-relaxed text-chalk-soft">
        <section>
          <h2 className="font-display text-xl font-bold text-chalk">Verantwortlich</h2>
          <address className="mt-3 not-italic">
            {business.legalName}
            {street && postal && (<><br />{street}<br />{postal} {main.city}</>)}
            {email && (<><br />{email}</>)}
          </address>
        </section>

        <section>
          <h2 className="font-display text-xl font-bold text-chalk">Was diese Website nicht tut</h2>
          <ul className="mt-4 space-y-2">
            {[
              'Keine Analyse- oder Tracking-Dienste.',
              'Keine Werbe-Cookies und keine Profilbildung.',
              'Keine eingebetteten Karten, Videos oder Social-Media-Inhalte, die beim Aufruf Daten an Dritte senden.',
              'Keine Weitergabe deiner Daten zu Werbezwecken.',
            ].map((item) => (
              <li key={item} className="flex gap-3">
                <span aria-hidden className="mt-2.5 h-1 w-3 shrink-0 rounded-sm bg-signal-500" />
                {item}
              </li>
            ))}
          </ul>
        </section>

        <section>
          <h2 className="font-display text-xl font-bold text-chalk">Server-Logfiles</h2>
          <p className="mt-3">
            Beim Aufruf dieser Website verarbeitet der Hostinganbieter technisch notwendige Zugriffsdaten wie IP-Adresse,
            Zeitpunkt, aufgerufene Seite und übertragene Datenmenge. Rechtsgrundlage ist Art. 6 Abs. 1 lit. f DSGVO —
            unser berechtigtes Interesse am sicheren und stabilen Betrieb der Website. Diese Daten werden nicht mit
            anderen Datenquellen zusammengeführt.
          </p>
        </section>

        <section>
          <h2 className="font-display text-xl font-bold text-chalk">Kontaktformular</h2>
          <p className="mt-3">
            Wenn du uns über das Kontaktformular schreibst, verarbeiten wir die von dir angegebenen Daten — Name,
            E-Mail-Adresse, optional Telefonnummer, gewählter Standort, Thema und deine Nachricht — ausschließlich zur
            Bearbeitung deiner Anfrage. Rechtsgrundlage ist deine Einwilligung nach Art. 6 Abs. 1 lit. a DSGVO sowie,
            soweit es um die Anbahnung eines Ausbildungsvertrags geht, Art. 6 Abs. 1 lit. b DSGVO.
          </p>
          <p className="mt-3">
            Zum Schutz vor automatisierten Anfragen wird die Zahl der Absendevorgänge je Internetverbindung technisch
            begrenzt. Deine Einwilligung kannst du jederzeit formlos widerrufen; die Rechtmäßigkeit der bis dahin
            erfolgten Verarbeitung bleibt davon unberührt.
          </p>
        </section>

        <section>
          <h2 className="font-display text-xl font-bold text-chalk">Schriftarten</h2>
          <p className="mt-3">
            Alle Schriftarten werden vom eigenen Server ausgeliefert. Es wird beim Seitenaufruf keine Verbindung zu
            Google Fonts oder einem anderen externen Anbieter aufgebaut.
          </p>
        </section>

        <section>
          <h2 className="font-display text-xl font-bold text-chalk">Deine Rechte</h2>
          <p className="mt-3">
            Du hast das Recht auf Auskunft, Berichtigung, Löschung, Einschränkung der Verarbeitung, Datenübertragbarkeit
            und Widerspruch. Wende dich dafür an die oben genannte Adresse. Außerdem steht dir ein Beschwerderecht bei
            einer Datenschutz-Aufsichtsbehörde zu — in Hessen ist das der Hessische Beauftragte für Datenschutz und
            Informationsfreiheit.
          </p>
        </section>

        <section className="rounded-xl border border-amber-500/25 bg-amber-500/[0.06] p-5">
          <h2 className="font-display text-base font-bold text-amber-400">Hinweis zur Fertigstellung</h2>
          <p className="mt-2 text-sm leading-relaxed text-chalk-dim">
            Diese Datenschutzerklärung beschreibt den technischen Stand dieser Website. Vor dem Livegang sollte sie
            juristisch geprüft und um Angaben zum tatsächlichen Hostinganbieter, zu Speicherfristen und gegebenenfalls
            zu einem Auftragsverarbeiter für den Formularversand ergänzt werden.
          </p>
        </section>
      </div>
    </>
  )
}
