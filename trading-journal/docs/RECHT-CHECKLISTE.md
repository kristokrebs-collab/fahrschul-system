# Recht-Checkliste (Entwurf – Prüfung durch Anwalt nötig)

Stand: 07.11.2026, geprüft gegen den Code dieses Zweigs und gegen Quellen, die am selben Tag abgerufen wurden (Liste am Ende, mit Vermerk, was selbst abgerufen und was nur als Suchtreffer gesehen wurde). **Das ist keine Rechtsberatung und keine Aussage, dass die App rechtskonform ist.** Die Tabelle trennt, was die App technisch erfüllt (Mechanik), wo ein Text vorhanden ist (Entwurf unter `docs/RECHT/`) und was offen ist oder beim Anwalt liegt. Die offenen Fragen stehen gesammelt in `docs/RECHT/anwaltsfragen.md`.

Status: **Mechanik** = die App tut es technisch; **Text** = Entwurf vorhanden (nie final); **offen** = fehlt im Code oder ungeklärt; **Anwalt** = Entscheidung beim Anwalt. Pfade relativ zu `trading-journal/`. Länder: nur Hinweise, keine Prüfung.

## 1. Anbieter, Texte und Hinweise

| Anforderung | Quelle | Status | Fundstelle | Länder (DE · EU · UK · US · andere) |
|---|---|---|---|---|
| Impressum: Name, Anschrift, E-Mail + schneller zweiter Kommunikationsweg, Vertreter, Register, USt-ID, Verantwortlicher | § 5 DDG; § 18 Abs. 2 MStV; § 27a UStG | Mechanik (aus `VITE_LEGAL_*`, fehlende Felder = markierter Platzhalter) + Text (Vorlage). Offen: zweiter Kommunikationsweg (nur Telefon-Variable, kein Formular), Aufsichtsbehörde falls erlaubnispflichtig | `src/legal/config.ts`, `src/legal/LegalSheet.tsx`, `docs/RECHT/impressum.md` | DE: DDG § 5. EU: E-Commerce-Richtlinie Art. 5, Umsetzung je Land. UK: Company/Business Names Regs, E-Commerce Regs 2002 reg. 6. US: kein Pflicht-Impressum, FTC/State-Hinweise je Fall |
| OS-Plattform-Link entfernt; Erklärung zur Verbraucherstreitbeilegung | § 36 VSBG; VO (EU) 2024/3228 (OS-Plattform seit 20.07.2025 abgeschaltet) | Text (Platzhalter), Anwalt (Schwelle > 10 Beschäftigte) | `docs/RECHT/impressum.md` | DE/EU: § 36 VSBG; UK: ADR-Regeln für regulierte Bereiche |
| Datenschutzerklärung (Art. 13): Verantwortlicher, Zwecke, Rechtsgrundlagen, Empfänger, Drittland, Dauer, Rechte, Beschwerde | Art. 13, 14 DSGVO | Text (Entwurf mit Platzhaltern); Empfängerliste aus dem Code abgeleitet; Dauer/Region/Behörde offen | `docs/RECHT/datenschutz.md`, `src/legal/LegalDocument.tsx` | DE: BDSG. EU: DSGVO. UK: UK GDPR + DPA 2018 (eigene Transfer-Mechanik „UK Extension“). US: Kalifornien CCPA/CPRA u. a. Bundesstaaten bei Schwellen. Andere: LGPD (BR), PIPEDA (CA) … |
| Information über lokale Speicherung, keine Tracker | § 25 TDDDG; Art. 13 DSGVO | Mechanik (Beleg unten, Abschnitt 5) + Text (Datenschutz Abschnitt 4, Karte „Rechtliches“); Anwalt: kosmetische Merker | `src/store/storage.ts`, `src/views/settings/LegalCard.tsx` | DE: TDDDG § 25. EU: ePrivacy-RL Art. 5(3). UK: PECR reg. 6. US: meist Opt-out-Regeln |
| AGB: Leistung, Laufzeit, Verlängerung, Kündigung, Haftung, Nutzung nur eigener Daten, keine Beratung | §§ 305 ff. BGB, § 309 Nr. 7, 9 BGB; §§ 327 ff. BGB | Text (Entwurf); Anwalt: Haftung, Änderungsklausel, Rechtswahl | `docs/RECHT/agb.md` | DE: AGB-Recht. EU: Klausel-RL 93/13, Digitale-Inhalte-RL 2019/770. UK: Consumer Rights Act 2015. US: einzelstaatlich, Auto-Renewal-Gesetze (z. B. Kalifornien ARL) |
| Widerrufsbelehrung, Muster-Formular, Zustimmung zum sofortigen Beginn | §§ 312g, 355, 356, 357a BGB; Art. 246a § 1 Abs. 2 EGBGB (Anlage 1, 2) | Text (Entwurf), **Mechanik offen** (keine Zustimmungs-Checkbox, Abschnitt 6), Anwalt | `docs/RECHT/widerruf.md`, `src/legal/consentTexts.ts` (`IMMEDIATE_START_CONSENT`) | EU: Verbraucherrechte-RL 2011/83 (14 Tage). UK: Consumer Contracts Regs 2013 (14 Tage). US: kein allgemeines Widerrufsrecht (FTC Cooling-Off nur bei Haustürgeschäften) |
| Preisangaben: Gesamtpreis inkl. USt, Zahlungsintervall, Laufzeit; Preisermäßigung | PAngV (§§ 3, 6, 11); § 5a UWG | Text (Entwurf), **offen** (kein „inkl. USt“ an den Preisen, Abschnitt 6) | `docs/RECHT/preisangaben.md`, `src/legal/consentTexts.ts` (`PRICE_TAX_NOTE`) | EU: Preisangaben-RL 98/6, Omnibus-RL 2019/2161. UK: CPUT 2008. US: FTC „junk fees“-Regel eng, einzelstaatlich |
| Steuer: EU-OSS, UK-/CH-/NO-MwSt, US Sales Tax | RL 2006/112/EG (Ort der Leistung); OSS-Verfahren; Wayfair-Schwellen (USA) | Mechanik teils (Stripe Tax nur mit `STRIPE_AUTOMATIC_TAX=true`, Standard aus), Betreiber/Anwalt | `netlify/functions/_lib/stripe.ts` (`automaticTax`, Zeile ~663), `docs/RECHT/preisangaben.md` | EU: OSS seit 01.07.2021; 10.000-EUR-Schwelle nur bei Sitz in einem Mitgliedstaat. UK: VAT-Registrierung ab Umsatz, Overseas-Sellers. US: SaaS je Bundesstaat unterschiedlich |
| Risikohinweis (Hebelprodukte, Simulation ≠ Prognose, Top-Trader ≠ Wale, keine Anlageberatung) | UWG §§ 5, 5a; aufsichtsrechtlich siehe Abschnitt 4 | Mechanik: „Keine professionelle Finanzberatung.“ je Analyse-Seite einmal (`AnalysisNote`, 12 Seiten; nicht auf Übersicht/Cockpit/Konto/Preise) + Text (Hinweise) + Karte „Rechtliches“; Anwalt: Reichweite | `src/ui/AnalysisNote.tsx`, `docs/RECHT/risikohinweis.md`, `src/legal/consentTexts.ts` (`RISK_SHORT`) | EU: MiFID II Art. 24 (nur für Wertpapierfirmen), ESMA zu Risikowarnungen bei CFDs (Anbieter). UK: FCA COBS 4 / Risk-Warnungen (Anbieter). US: SEC/CFTC-Disclosure bei Beratern |
| Partnerlink-Kennzeichnung („Werbung“), standardmäßig aus | § 5a Abs. 4 UWG; § 6 DDG | Mechanik: im Code gibt es **keine** Partnerlinks (Suche in `src` ohne Treffer); Referral-Karte nutzt eigenes Programm. Text (Kennzeichnungssatz), Anwalt (Referral-Provisionen) | `docs/RECHT/partnerlinks.md`, `src/legal/consentTexts.ts` (`PARTNER_LINK_LABEL`), `src/billing/ui/ReferralCard.tsx` | EU: UGP-RL Anh. I Nr. 11. UK: CAP-Code/ASA. US: FTC Endorsement Guides (16 CFR 255) |
| Drittanbieter-Marken, keine Partnerschaft behaupten; Quellenangabe lightweight-charts | MarkenG § 23; Apache-2.0 (NOTICE) | Mechanik: Quellenangabe im Footer (`ChartAttribution`); Text (Marken) | `src/chart/attribution.ts`, `public/NOTICE-lightweight-charts.txt`, `docs/RECHT/marken.md` | weltweit ähnlich (beschreibende Nutzung); je Anbieter Nutzungsbedingungen |
| Barrierefreiheit (Dienste im elektronischen Geschäftsverkehr) | BFSG (seit 28.06.2025); EU-Richtlinie 2019/882 | offen / Anwalt (Kleinstunternehmen-Ausnahme, Erklärung) | Teilmechanik: Tastatur, Touch ≥ 44 px, Kontrast-Tests (Projektregeln); kein Nachweis nach EN 301 549 | EU: European Accessibility Act. UK: Equality Act. US: ADA (Rechtsprechung) |
| Alter / Minderjährige | Art. 8 DSGVO; AGB | offen (nur Text „ab 18“, keine Abfrage, keine Sperre) | `docs/RECHT/agb.md` § 3 | EU-Staaten 13–16 Jahre (Art. 8). UK 13. US COPPA < 13 |

## 2. Kaufstrecke (Mechanik gegen die Norm geprüft)

Geprüfte Dateien: `src/billing/ui/UpgradeSheet.tsx`, `src/billing/store.ts` (`startCheckout`), `src/billing/strings.ts`, `src/views/preise/*`, `src/billing/ui/CancelSheet.tsx`, `src/billing/ui/PlanCard.tsx`, `netlify/functions/billing-checkout.mts`, `netlify/functions/_lib/stripe.ts`. **Ich habe keine dieser Dateien geändert** (Auftrag: Meldung, kein Eingriff).

| Anforderung | Quelle | Befund im Code | Status |
|---|---|---|---|
| Bestell-Schaltfläche „zahlungspflichtig bestellen“ oder gleich eindeutig | § 312j Abs. 3, 4 BGB | Die Schaltflächen in der App heißen „N Tage gratis testen“ (`UPGRADE.cta`, `PREISE.ctaTrial`), „Jetzt abonnieren“ (ohne Testphase) und „Anmelden und testen“. Der eigentliche Abschluss geschieht auf der Stripe-Seite (`redirectToStripe`); deren Button („Abonnieren“/„Testversion starten“) ist nicht konfiguriert (`custom_text` fehlt). Ein Abo ohne Hinweis auf Zahlungspflicht an der Schaltfläche riskiert, dass der Vertrag nach § 312j Abs. 4 BGB nicht zustande kommt. | **Lücke / Anwalt** |
| Pflichtangaben „unmittelbar bevor“ die Bestellung abgegeben wird (Preis, Laufzeit, Verlängerung, Kündigung) | § 312j Abs. 2 BGB; Art. 246a § 1 Abs. 1 Satz 1 EGBGB | Im Upgrade-Dialog stehen Preis, Zeitraum, „jederzeit zum Laufzeitende kündbar“, Testtage. Es fehlt ausdrücklich: Preis **nach** der Testphase und dass sich das Abo automatisch verlängert; Mindestlaufzeit/Verlängerungsregel nur in AGB-Entwurf. | **Lücke** |
| Zustimmung zum sofortigen Beginn + Kenntnis Wertersatz/Erlöschen | § 356 BGB; § 357a BGB | Nicht vorhanden. Der Dialog hat nur ein Kästchen für AGB/Widerruf/Datenschutz (`ConsentCheck`, `termsAccepted`). Der Tarif wird sofort per Webhook freigeschaltet. Wortlaut liegt bereit (`IMMEDIATE_START_CONSENT`), ist nicht eingebaut. | **Lücke** |
| Widerrufsfunktion (Schaltfläche „Vertrag widerrufen“, 2 Schritte, Eingangsbestätigung) | § 356a BGB (seit 19.06.2026); RL (EU) 2023/2673 Art. 11a | Nicht vorhanden (weder Schaltfläche noch Eingangsbestätigung). | **Lücke** |
| Kündigungsschaltfläche „Verträge hier kündigen“ + Bestätigungsseite „Jetzt kündigen“, ständig verfügbar | § 312k Abs. 2 BGB | Vorhanden: „Verträge hier kündigen“ auf der Preisseite (`legal-cancel`), „Vertrag hier kündigen“ in der Plan-Karte (`PLAN_CARD.cancel`), Bestätigung „Jetzt kündigen“ (`CANCEL.confirm`). **Aber:** ohne Anmeldung öffnet der Knopf zuerst die Anmeldung (`PreiseView` `LegalLine`); nach Rechtsprechung (OLG Nürnberg 3 U 2214/23; OLG Düsseldorf 20 UKl 3/23) soll er ohne Login erreichbar sein (umstritten, Quellen sekundär). Kein Link im Footer. | **Lücke / Anwalt** |
| Kündigungsdialog: nur Grund (freiwillig) und Bestätigung, keine Hürden | § 312k Abs. 2; Rechtsprechung | `CancelSheet` hat Schritte „Grund → Angebot (Pause/Tarif wechseln) → Bestätigung“; die Angebote sind überspringbar („Weiter zur Kündigung“). Ob der Zwischenschritt zulässig ist, ist offen (BGH-Entscheidung 2026 zur Bestätigungsseite laut Sekundärquelle). | **Anwalt** |
| Kündigung speicherbar und elektronisch bestätigt (Inhalt, Datum, Uhrzeit, Beendigungszeitpunkt) | § 312k Abs. 3, 4 BGB | Anzeige im Dialog mit Enddatum (`CANCEL.confirmText`); **keine E-Mail-Bestätigung** und keine Speicherfunktion im Code (kein eigener Versand in `_lib/stripe.ts` oder `billing-*.mts`; ob Stripe selbst eine Kündigungsmail schickt, hängt von der Stripe-Einstellung des Betreibers ab und ist nicht belegt). | **Lücke** |
| Vertragsbestätigung auf dauerhaftem Datenträger | § 312f BGB | Stripe sendet Beleg/Rechnung; Vertragsbestätigung mit AGB/Widerrufsbelehrung als E-Mail nicht belegt. | **offen** |
| Einwilligungs-/Zustimmungsnachweis (Zeit, Textfassung, Nutzer) | Art. 7 Abs. 1 DSGVO; Beweislast | `termsAccepted` ist nur Sitzungszustand im Browser (`billing/store.ts`), nicht auf dem Server gespeichert; Stripe `consent_collection` nicht gesetzt. | **Lücke** |
| Preis mit Steuerhinweis „inkl. USt“, Zeitraum | § 3 PAngV | Preisseite/Dialog zeigen Betrag + „pro Monat/Jahr“; `PREISE.legalNote` sagt „Preise in Euro“ ohne „inkl. USt“. Listenpreise sind laut `plans.ts` brutto, werden aber nicht so bezeichnet. Stripe Tax standardmäßig aus (`STRIPE_AUTOMATIC_TAX`). | **Lücke** |
| „Jährlich −X %“ als Preisvergleich | § 11 PAngV; § 5 UWG | Segmented-Label im Dialog (`UpgradeSheet`), Prozent aus 12 × Monatspreis. | **Anwalt** |
| Automatische Verlängerung, Jahresabo gegenüber Verbrauchern | § 309 Nr. 9 BGB | Jahresabo verlängert sich um ein Jahr (Stripe-Voreinstellung); Kündigung zum Laufzeitende. Zulässigkeit nach § 309 Nr. 9 b/c offen. | **Anwalt** |
| AGB-Zustimmung vor Registrierung und vor Checkout, Links erreichbar | § 305 Abs. 2 BGB; Art. 246a EGBGB | Vorhanden: Pflicht-Kästchen in `AuthSheet` und `UpgradeSheet`, Links `LegalLink` (Entwurf oder Betreiberseite). Ohne eingetragene Betreiberseiten öffnen die Links den **Entwurf** (markiert). | **Mechanik** |
| Der Dienst blockiert sich nicht, wenn Rechtstexte fehlen | Betreiberpflicht | Die Kaufstrecke prüft `legalComplete()` **nicht**: Checkout läuft auch ohne Impressum/AGB-Seiten. Empfehlung: Checkout sperren, solange `legalComplete(legalConfig())` falsch ist. | **offen (Entscheidung Betreiber)** |
| Rechnungen, Zahlungsmittel, Portal (Verwaltung) | Stripe-Funktion | Portal und Rechnungsliste vorhanden (`BillingCard`, `createPortal`). | **Mechanik** |

## 3. Datenschutz-Mechanik

| Anforderung | Quelle | Status | Fundstelle |
|---|---|---|---|
| Auskunft und Datenübertragbarkeit (Export) | Art. 15, 20 DSGVO | Mechanik: JSON-Export mit Journal, Profil, Protokoll, Verbindungs-Metadaten, Dateiliste; 5 Exporte/Stunde; Schlüssel ausgeschlossen | `netlify/functions/account-export.mts`, `_lib/account.ts` |
| Löschung | Art. 17 DSGVO | Mechanik: Abos kündigen, Teams freigeben, Dateien löschen, Konto löschen (Kaskade); Rechnungen bleiben bei Stripe (Aufbewahrung); lokale Daten bleiben im Browser | `netlify/functions/account-delete.mts`, `_lib/billingCleanup.ts` |
| Voreinstellung datensparsam | Art. 25 DSGVO | Mechanik: Fehlerberichte nur mit Opt-in (Standard aus), Ranglisten nur mit Zustimmung, keine Tracker | `src/cloud/report.ts`, `src/cloud/ui/PrivacyCard.tsx` |
| Sicherheit der Verarbeitung (Verschlüsselung, Zugriff) | Art. 32 DSGVO | Mechanik: Börsenschlüssel AES-256-GCM, RLS in den Migrationen, 2FA, Rate-Limits, IP nur als HMAC-Pseudonym | `netlify/functions/_lib/crypto.ts`, `supabase/migrations/*`, `_lib/audit.ts` |
| Speicherbegrenzung | Art. 5 Abs. 1 lit. e DSGVO | Teils: Sicherungen 14 Tage, Fehlerberichte 30 Tage; Dauer des `audit_log` und der Server-Protokolle offen | `netlify/functions/_lib/account.ts`, `backup-nightly.mts` |
| Auftragsverarbeitung, Verzeichnis der Verarbeitungstätigkeiten | Art. 28, 30 DSGVO | offen (Verträge/AVV mit Supabase, Netlify, Stripe, Resend, ggf. Twilio, Anthropic; Verzeichnis) – Betreiber/Anwalt | – |
| Drittlandübermittlung (DPF/SCC) | Art. 44 ff. DSGVO | offen/Anwalt; DPF-Beschluss vom 10.07.2023, EuG T-553/23 vom 03.09.2025, Rechtsmittel anhängig; Zertifizierungen am Veröffentlichungstag prüfen | `docs/RECHT/datenschutz.md` Abschnitt 14 |
| **Befund:** Browser verbindet sich beim Start direkt mit Binance (Preconnect) und holt Marktdaten von Binance/Bybit/OKX | Art. 6, 13, 44 ff. DSGVO | offen/Anwalt (IP-Adresse an Drittanbieter ohne vorherige Auswahl; Weg über eigenen Server nur auf Wunsch) | `index.html` (preconnect), `src/app/marketBoot.ts`, `src/market/feeds.ts` (`DEFAULT_SOURCE_CHAIN`), `netlify.toml` (`connect-src`) |
| KI-Funktionen, Telefonie | Art. 6, 28, 44 ff. DSGVO; KI-VO Art. 50 (Transparenz, Stand prüfen) | Text (Abschnitte 9, 10), offen: Telefonie noch nicht gebaut (Paket C2); KI nur optional serverseitig | `netlify/functions/coach-ask.mts`, `shot-extract.mts` |

## 4. Finanzdienstleistung und Anlageempfehlung (höchstes Risiko – Anwaltsfrage Nr. 1–6)

**Klare Benennung:** Ob Signale (Branchen-Trend Grün/Rot, Lage-Ampel, Einstiegs-Check, TradingView-Signal-Empfänger) und die geplante Kette Signal → Kandidatenprüfung → Paper-Position als **Anlageempfehlung** oder **Anlageberatung** gelten, ist ein juristisch zu klärendes Risiko. Die App sagt „keine Anlageberatung“, aber die Einordnung hängt am Inhalt, nicht an der Selbstbezeichnung. Ich habe die Frage nicht entschieden und nicht entschärfen können.

| Land / Raum | Berührungspunkt | Quelle (Stand 07.11.2026) | Hinweis |
|---|---|---|---|
| DE | Anlageberatung = Finanzdienstleistung, erlaubnispflichtig; Anlageempfehlungen nach MAR/WpHG | § 1 Abs. 1a Nr. 1a KWG; § 2 Abs. 8 WpHG; BaFin | persönliche Empfehlung zum Kauf/Verkauf eines Finanzinstruments = Beratung; allgemeine Information, die nicht auf die Person zugeschnitten ist, eher nicht (fraglich bei „Kandidatenprüfung gegen deine Limits“) |
| EU | „Anlageempfehlung“ (Informationen, die direkt oder indirekt einen bestimmten Anlagevorschlag zu einem Finanzinstrument empfehlen) | Art. 3 Abs. 1 Nr. 34, 35 und Art. 20 MAR (VO (EU) 596/2014); Delegierte VO (EU) 2016/958; ESMA-MAR-Q&A (Form egal, Fall-zu-Fall) | Pflichten: objektive Darstellung, Offenlegung von Interessen; auch an die Allgemeinheit verbreitete Empfehlungen können erfasst sein |
| EU | Krypto: „Beratung zu Kryptowerten“ | Art. 3 Abs. 1 Nr. 24, Art. 81 MiCA (VO (EU) 2023/1114); ESMA Q&A 2882 (2026): weiter als MiFID II, Kriterien Zuschnitt auf die Person und „als geeignet dargestellt“; Q&A 2463 (2025): Copy-/Auto-Trading nach MiFID-Maßstäben analog | Perpetuals auf Krypto: je nach Konstruktion Derivat (MiFID/MAR) oder MiCA-Dienst – offen |
| UK | Beratung („advising on investments“) ist regulierte Tätigkeit; Werbung für Kryptowerte | Art. 53 RAO; § 21 FSMA (Finanzwerbung); Krypto-Werbe-Regime seit 08.10.2023 (FCA PS23/6) | Werbung gegenüber UK-Verbrauchern kann ohne Erlaubnis/Freigabe strafbar sein; Sperre oder Freigabe-Weg nötig |
| US | Investment Adviser (SEC); Commodity Trading Advisor (CFTC); Publisher-Ausnahme | Investment Advisers Act § 202(a)(11); Lowe v. SEC, 472 U.S. 181 (1985): gedruckte/allgemeine, nicht individualisierte Publikationen ausgenommen; CEA § 1a(12) | Ausnahme endet bei Personalisierung (SEC „Weiss Research“); Staatenrecht zusätzlich |
| Andere | Schweiz FIDLEG/FINIG, Singapur MAS, VAE VARA, Australien ASIC (AFSL), Kanada (CSA) | nur Hinweis, nicht geprüft | Geoblocking oder Länderausschluss in den AGB prüfen |

## 5. Beleg: Speicher und Fremdverbindungen (Cookie-/Speicher-Hinweis nötig?)

Geprüft per Code-Suche am 07.11.2026 (`src/`, `index.html`, `public/`, `netlify.toml`).

- **Cookies:** kein Treffer für `document.cookie`; Supabase-Auth speichert die Sitzung im Local Storage (`persistSession: true`, `storageKey` in `src/cloud/client.ts`).
- **Tracker/Analytics:** kein Treffer für gtag, analytics.js, plausible, matomo, sentry, hotjar, fbq, sendBeacon; `reportError` nur mit Opt-in (`src/cloud/report.ts`).
- **Fremde Schriften/Skripte/CDN:** keines. Schriften eingebettet (`src/styles/fonts.css`, Kommentar in `index.html`); CSP `script-src 'self' 'wasm-unsafe-eval'`, `font-src 'self' data:`, `frame-src 'none'` (`netlify.toml`); OCR-Daten kommen von der eigenen Seite (`/ocr/…`).
- **Service Worker:** keiner (kein `serviceWorker` im Code).
- **Gespeichert wird:** Local Storage (Journal `tj2-*`, Einstellungen, Oberflächen-Zustand, Auth), IndexedDB (Screenshots, Marktdaten-Cache, Archiv), Session Storage (einmalige Animationen: `tj2-fill-*`, Coach-Hero). Das ist der vom Nutzer ausdrücklich gewünschte Dienst („Journal“); Ausnahme „unbedingt erforderlich“ nach § 25 Abs. 2 Nr. 2 TDDDG (Wortlaut nach dejure.org, 07.11.2026 abgerufen).
- **Folgerung:** Kein Einwilligungsbanner geplant. Offen/Anwalt: rein kosmetische Merker (Animation „schon gesehen“) sind nicht streng „unbedingt erforderlich“; Risiko gering, siehe Anwaltsfrage 22.
- **Meldung (kein Banner-Thema, aber Datenschutz):** Der Browser kontaktiert beim Seitenstart Binance (`<link rel="preconnect" href="https://fapi.binance.com">`, `dns-prefetch fstream.binance.com`) und holt danach Marktdaten bei Binance, ersatzweise Bybit/OKX. Die Börse sieht die IP-Adresse. Das ist **Nicht-Notwendiges im Sinne von „Daten gehen an Dritte“**, auch wenn nichts auf dem Gerät gespeichert wird; Information in der Datenschutzerklärung steht im Entwurf (Abschnitt 5), die Rechtsgrundlage und die Voreinstellung (eigener Server statt direkt) sind offen.

## 6. Lücken, die der Hauptagent beachten muss (Kaufstrecke, nicht von mir geändert)

1. Bestell-Button: „zahlungspflichtig“ im Wortlaut (`BUTTON_LABELS.order`, `orderTrial` in `src/legal/consentTexts.ts`); Stripe-Button und `custom_text.submit` prüfen (§ 312j Abs. 3).
2. Zustimmungs-Kästchen „sofortiger Beginn“ (`IMMEDIATE_START_CONSENT`), getrennt von AGB, nicht vorangekreuzt; Nachweis serverseitig speichern (Zeit, Textfassung, Nutzer).
3. Hinweis vor der Bestellung: Preis nach Testphase, automatische Verlängerung, Laufzeit (§ 312j Abs. 2).
4. Widerrufsfunktion (§ 356a BGB, seit 19.06.2026) bauen: Schaltfläche „Vertrag widerrufen“ ohne Login, zweistufig, Eingangsbestätigung per E-Mail.
5. Kündigung: Schaltfläche ohne Login erreichbar machen (Footer-Link), Bestätigung „Jetzt kündigen“, Kündigungsbestätigung per E-Mail mit Datum/Uhrzeit (§ 312k Abs. 3, 4).
6. Preise: `PRICE_TAX_NOTE` an allen Preisen; `STRIPE_AUTOMATIC_TAX` und Preis-`tax_behavior` in Stripe klären; „Jährlich −X %“ vom Anwalt prüfen lassen.
7. Checkout sperren, solange `legalComplete(legalConfig())` falsch ist (Betreiberentscheidung).
8. Vertragsbestätigung (AGB, Widerrufsbelehrung) per E-Mail auf dauerhaftem Datenträger (§ 312f BGB).

## 7. Quellen

Selbst abgerufen am 07.11.2026 (Inhalt gelesen):

- § 312j BGB: <https://dejure.org/gesetze/BGB/312j.html>
- § 312k BGB (Zusammenfassung des Textes): <https://dejure.org/gesetze/BGB/312k.html>
- § 356 BGB: <https://dejure.org/gesetze/BGB/356.html> (Absatzzählung vor Verwendung gegen die aktuelle Fassung prüfen)
- § 25 TDDDG: <https://dejure.org/gesetze/TDDDG/25.html>
- Widerrufsbutton 2026 (Stripe): <https://stripe.com/de/resources/more/withdrawal-button-2026-germany>
- EU-OSS: <https://vat-one-stop-shop.ec.europa.eu/one-stop-shop_en>

Als Suchtreffer gesehen, Inhalt nur aus der Trefferzusammenfassung (Primärquelle prüfen):

- § 356a BGB, Umsetzungsgesetz zum Widerrufsbutton, BGBl. 2026 I Nr. 28: <https://www.noerr.com/de/insights/umsetzungsgesetz-zum-widerrufsbutton-veroeffentlicht>, <https://www.bitkom.org/sites/main/files/2026-05/bitkom-praxisleitfaden-zur-umsetzung-des-widerrufsbuttons.pdf>
- Kündigungsbutton ohne Login: <https://www.ra-plutte.de/olg-duesseldorf-online-kuendigung-muss-ohne-login-moeglich-sein/>, <https://www.gesetze-bayern.de/Content/Rtf/Y-300-Z-GRURRS-B-2024-N-22885?all=False> (OLG Nürnberg 3 U 2214/23), Gegenansicht: <https://cms.law/de/deu/legal-updates/olg-nuernberg-kuendigungsbutton-nach-login-zulaessig>, BGH-Entscheidung 2026: <https://www.nwb-experten-blog.de/online-kuendigung-ohne-tricks-bgh-konkretisiert-anforderungen-an-kuendigungsbuttons/>
- PAngV (Fassung seit 28.05.2022, Gesamtpreis inkl. USt): <https://www.haendlerbund.de/de/ratgeber/recht/3823-preisangabenverordnung>, Entscheidung OLG Bamberg 3 UKl 4/25 e: <https://www.gesetze-bayern.de/Content/Rtf/Y-300-Z-BECKRS-B-2026-N-4408?all=False>
- OS-Plattform abgeschaltet: <https://www.ihk.de/stuttgart/fuer-unternehmen/recht-und-steuern/it-recht/os-plattform-zur-streitbeilegung-wird-eingestellt-6488402>
- EU-US Data Privacy Framework, EuG T-553/23: <https://www.euronews.com/next/2025/09/03/eu-court-upholds-smooth-transfer-of-data-from-europe-to-us>; Rechtsmittel C-703/25 P (nur eine Quelle): <https://digitalpolicyalert.org/change/7373-lawsuit-requesting-suspension-of-the-execution-of-adequacy-decision-for-the-eu-us-data-privacy-framework-latombe-v-commission>
- ESMA Q&A 2882 (MiCA-Beratung): <https://www.esma.europa.eu/publications-data/questions-answers/2882>; Q&A 2463 (Auto-Trading): <https://micawtf.pages.dev/eu-level/q-and-a/esma-qa-2463-auto-trading/>; MAR-Anlageempfehlungen: <https://paulhastings.com/insights/client-alerts/market-abuse-regulation-investment-recommendations>
- FCA Krypto-Finanzwerbung seit 08.10.2023: <https://cms.law/en/int/legal-updates/fca-publishes-final-rules-and-supplementary-draft-guidance-on-financial-promotions-for-cryptoassets>
- SEC Publisher-Ausnahme, Lowe v. SEC: <https://www.law.cornell.edu/supremecourt/text/472/181>

Nicht abgerufen, aus eigenem Wissen genannt (bitte prüfen): § 5 DDG, § 18 MStV, § 36 VSBG, § 309 BGB, § 312f BGB, § 357a BGB, Art. 246a EGBGB, Art. 13/25/28/32 DSGVO, Art. 3/20 MAR, Art. 81 MiCA, § 1 KWG, BFSG, Art. 53 RAO, Advisers Act, CEA, KI-Verordnung Art. 50.
