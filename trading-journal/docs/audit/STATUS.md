# Launch-Audit D1: ehrlicher Ist-Stand (Browser-Audit, Elementinventur, Erstbesucher-Sicht)

Stand: 08.11.2026 · Basis: `13bbb7d` (PR #6, Branch `claude/journal-ux-etappen`) plus die Änderungen dieses Pakets · Pfade relativ zu `trading-journal/`.

**Das ist keine Freigabe und keine Rechtsaussage.** Es ist der Befund eines Browser-Audits in einer Sandbox mit geteilter CPU. Alles, was nur gegen Mock, Fixture oder PGlite läuft, steht hier als „nur Mock“, nie als „fertig“. Rechtstexte sind Entwürfe (`docs/RECHT/`).

## 1. Entscheidung nach Auftrag Abschnitt 9: **NO-GO**

Die Freigabebedingungen des Auftrags und ihr Stand heute:

| Bedingung (Abschnitt 9) | Stand | Beleg |
| --- | --- | --- |
| Alle vermarkteten Produktfunktionen echt und nachgewiesen | **nein**: jede Funktion mit Fremddienst (Konto, Zahlung, Börsen, TradingView, Telefon, Mail, KI) ist nur gegen Mock, Fake oder Fixture belegt | `docs/ABNAHME-40.md` (20 automatisch, 19 nur Mock, 1 offen); in diesem Audit: Konto und Preise nur gegen `tests/e2e/mocks/*` |
| Keine P0-/Security-/Payment-/Auth-/Data-Loss-Defekte | **offen**: im Browser keine Datenverlust-Defekte gefunden, zwei P0-Defekte gefunden und behoben (siehe 4.1), aber nichts davon beweist Auth/Zahlung/Isolation gegen ein echtes Backend | Abschnitt 4 |
| Kauf und Registrierung mit zwei Nutzern inkl. Fehlerpfade | **BLOCKED**: kein Supabase-Projekt, kein Stripe-Konto | Vorschau: Konto-Seite „Cloud nicht eingerichtet“, `/api/v1/billing/status` antwortet `500 server_misconfigured` (8.11., curl) |
| Reale Abo-Freischaltung und Kündigung | **BLOCKED**: kein Stripe, kein Webhook, kein Portal | `docs/BETREIBER-AUFGABEN.md` §4 |
| Original-Screenshots, Simulation, Historie persistent | lokal belegt (Tests laufen im Browser-Speicher), **Cloud-Bucket BLOCKED** | `docs/ABNAHME-40.md` Punkte 19, 23 |
| Mobile Bedienbarkeit | **teilweise**: Emulation bei 390/768/1280/1440 px, **kein echtes Gerät** | Abschnitt 3; `docs/UX-MATRIX-74.md` (V15) |
| Anbieterrechte geklärt | **offen** (Binance, TradingView, Marktdatenquellen) | `docs/RECHT/anwaltsfragen.md` (Nr. 17, 27) |
| Produktive Betreiber-Integrationen eingerichtet | **nein** | Abschnitt 8 |
| Rechtlich offene Texte der fachlichen Prüfung vorgelegt | **teilweise**: Entwürfe da, in der Vorschau zeigt das Impressum „PLATZHALTER“ | Abschnitt 5 (Fußzeile), `docs/RECHT/README.md` |

## 2. Was geprüft wurde, und wie

- **Stand der Vorschau**: Zu Beginn verwies `index.html` der gehosteten Vorschau auf `assets/index-DUTCTlvp.js`, dieselbe Datei wie der lokale Build von `13bbb7d`. **Während des Audits wurde die Vorschau neu ausgeliefert** (heute `index-hep9kwqx.js`; ein Fehlerrahmen im Crawl stammt von einem veralteten Chunk-Pfad, siehe 4.2). Die Daten der Vorschau mischen deshalb zwei Stände. Die lokalen Builds tragen die drei Korrekturen dieses Pakets. Gemessen mit `npm run budget` auf sauberem Stand: Erstladung **JS 654,9 / 800 KiB, CSS 51,9 / 52 KiB** (gzip); die CSS-Reserve beträgt 0,1 KiB, dieses Paket hat sie nicht angetastet. (Zwischendurch zeigte der Messlauf 52,7 KiB: Tailwind liest untracked Ordner mit und hatte meine temporären Build-Ordner `dist-r3` und `dist-e2e-cloud-r3` mitgescannt; ohne sie, auch in einer sauberen Kopie des Quellstands, sind es 51,9.)
- **Vier Ziele**: die gehostete Vorschau (nichts gemockt, Erstbesucher), der lokale Default-Build (Fixture-Journal, Markt-Mock der E2E-Suite), der lokale Default-Build mit leerem Journal (Erstbesuch, Einführung erlaubt) und der Cloud-Build gegen den Supabase-Mock der E2E-Suite, abgemeldet und angemeldet (echter Login-Dialog, `tests/e2e/cloudSignIn.ts`).
- **Vier Viewports, ehrlicher Umfang**: Auf 390, 768, 1280 und 1440 px wurde jede Seite und jedes Overlay erfasst (Inventur, Konsole, Requests, Überlauf, Screenshot). **Angeklickt** wurde nur auf **390 und 1440 px**: im lokalen Build alle 19 Seiten und 6 Overlays, in der Vorschau die Kernstrecke (Übersicht, Preise, Konto, Funktionen, Einstellungen, Menü), im leeren Journal die Übersicht. **Die Cloud-Personen (Supabase-/Billing-Mock) wurden aus Zeitgründen nur auf vier Bildschirmen plus Overlays gecrawlt**: abgemeldet Übersicht, Preise, Konto, Anmelden, Registrieren; angemeldet Übersicht, Preise, Konto, Einstellungen, Bestellübersicht, Tarif im Detail. Alle anderen Seiten im Cloud-Build (Community, Funktionen, Markt usw.) sind dort nicht angeklickt; sie laufen im lokalen Build. Auf 768 und 1280 px wird nichts angeklickt (außer den Anmelde-Overlays der abgemeldeten Cloud-Person). Die CSV sagt es je Zeile („nur erfasst“ gegen „ok/dead-…“).
- **Wie geklickt wird** (`tests/audit/auditLib.ts`): Jedes sichtbare Element (Link, Knopf, Tab, Segment, Schalter, Feld, Dropdown, Dialog-X) wird in die Bildschirmmitte gerollt, einmal angeklickt (Felder: Eingabe, Auswahlfelder: anderer Wert) und beobachtet: Adresse, geöffnete oder geschlossene Dialoge, Toast, Zustand des Elements (`aria-*`, `data-state`, `<details>`), Formularwerte, Requests der App, Anfragen an Marktdaten, Scroll durch den Klick, neuer Tab, Download, DOM-Änderungen über dem Leerlaufrauschen des Bildschirms. Danach wird die Seite zurückgestellt (Dialoge zu, Adresse zurück, bei großer Abweichung neu geladen). Ein Element ohne Reaktion wird ein zweites Mal mit längerer Wartezeit geklickt, ein gescheiterter Klick wird auf frisch geladener Seite wiederholt.
- **Was „tot“ heißt**: kein Effekt **und** kein Handler = tot (`dead-candidate`). Handler vorhanden, aber nichts sichtbar = `no-effect-handler` (kann ein gewolltes Leerlauf-Verhalten sein, ein Mensch bewertet). Bereits gewählte Option erneut anklicken zählt nicht. Jede der Zeilen mit P0/P1 wurde von Hand am Quelltext oder im Browser nachgeprüft (Spalte Nachweis: „MANUELL“, Regeln in `scripts/audit/annotations.json`).
- **Tastatur**: pro angeklicktem Bildschirm ein Tab-Durchlauf (bis 40 Schritte): erreichte Elemente, sichtbarer Fokus, Fokusfalle. **Touch-Ziele**: auf 390 px die Treffer-Messung der E2E-Suite (`tests/e2e/hitbox.ts`, 44 px).
- **Journeys** (`tests/audit/journeys.spec.ts`, `addresses.spec.ts`): Erstbesucher gegen den Cloud-Build mit Supabase- und Billing-Mock, Fußzeile/Rechtliches am Seitenende, erste Sekunden der Vorschau, 16 ungewöhnliche Adressen.
- **Nicht geprüft** (und auch nicht behauptet): echte Geräte, echte Mail-Zustellung und Bestätigungslink, echte Supabase-Auth-Grenzen (Rate-Limit, Account-Enumeration), Stripe, Webhooks, Binance (die Sandbox bekommt dort HTTP 451), TradingView, Twilio, Anthropic, Backup und Restore im echten Projekt, Visual-Regression-Pixelvergleich, Core Web Vitals auf ruhiger Maschine (die CPU war mit 15 bis 25 Last auf 4 Kernen durch andere Läufe belegt).

## 3. Ergebnis in Zahlen

Quelle: `docs/audit/INTERACTION_AUDIT.csv` (2.569 Zeilen, Semikolon, zehn Spalten des Auftrags), `docs/audit/evidence/summary.json`, `journeys.json`, `addresses.json`, `names.json`. 20 Crawl-Einheiten (Person × Viewport), 248 Bildschirme, **1.759 angeklickte Elemente**.

| Einheit (Person @ Viewport) | Bildschirme | erfasste Elemente | angeklickt | tot / ohne Wirkung* | verdeckt | Überlauf quer | Ziele < 44 px (nur 390) |
| --- | --- | --- | --- | --- | --- | --- | --- |
| Vorschau @390 / @1440 | 25 / 25 | 1.433 / 1.756 | 134 / 186 | 6 / 3 | 0 / 1 | 0 / 0 | 17 |
| Vorschau @768 / @1280 | 25 / 25 | 1.768 / 1.765 | nur erfasst | – | – | 0 / 0 | – |
| lokal @390 / @1440 | 25 / 25 | 2.168 / 2.604 | 268 / 631 | 2 / 6 | 3 / 3 | 0 / 0 | 16 |
| lokal @768 / @1280 | 25 / 25 | 2.515 / 2.577 | nur erfasst | – | – | 0 / 0 | – |
| lokal, leeres Journal @390 / @1440 | 1 / 1 | 115 / 138 | 34 / 62 | 1 / 0 | 0 / 0 | 0 / 0 | 2 |
| Cloud abgemeldet @390 / @1440 | 5 / 5 | 225 / 289 | 91 / 112 | 0 / 1 | 0 / 0 | 0 / 0 | 23 |
| Cloud angemeldet @390 / @1440 | 6 / 6 | 692 / 843 | 78 / 121 | 0 / 3 | 0 / 0 | 0 / 0 | 24 |

\* Rohwert des Crawls „kein Effekt“ oder „Handler ohne sichtbare Wirkung“, **vor** der Handprüfung. Nach der Handprüfung (Spalte Nachweis „MANUELL“): **0 offene P0, 1 offene P1, 225 offene P2** (davon 186 reine „nur erfasst“-Zeilen als Abdeckungs-Hinweis), 3 P0 und 1 P2 repariert, 2.339 Zeilen ohne Befund. `names.spec.ts` prüfte 3.820 Bedienelemente auf einen zugänglichen Namen: **0 ohne Namen**.

- **Tote Elemente**: 22 Rohtreffer des Crawls (15 „Handler ohne sichtbare Wirkung“, 2 „ohne Handler“, 1 Eingabe ×5 Läufe, dazu „verdeckt“-Klicks), je Zeile von Hand oder per Test eingeordnet: **3 echte** (4.1: „Tarif im Detail“ ×3), die übrigen Crawl-Artefakte oder gewolltes Leerlauf-Verhalten (Begründung in der Spalte Nachweis, „MANUELL“). **Nicht bestätigt bleiben** (P2): die drei Markt-Knöpfe (4.2), „Letzten Trade duplizieren“ im Tastenkürzel-Overlay, die Gruppe „Top-Trader (Binance) netto“ auf Markt und „Übersicht“ im Kopf. **Keine `href="#"`, keine leeren Links, jeder neue Tab mit `noopener`** (Quelltext, `tests/unit/audit.interaction.test.ts`).
- **Konsole und Requests**: Alle Konsolenzeilen der Sandbox (Binance, Bybit, OKX: HTTP 451 oder CORS, geblockte Fremdhosts) sind in der CSV als „aus Testwelt/Sandbox“ markiert und nicht dem Produkt zugerechnet. **Eigene Fehler der App**: keine unbehandelte Ausnahme im Crawl; zwei Fehlerrahmen waren erklärbar (veralteter Chunk nach Neuauslieferung, 404 der Funktionen im lokalen Build).
- **Überlauf**: auf keinem Bildschirm bei keinem der vier Viewports ein waagerechter Überlauf.
- **Redirect-Schleifen**: keine. 16 ungewöhnliche Adressen (`addresses.json`): alle landen auf einem Bildschirm, kein Weiß, keine Schleife (Ausnahmen in 4.2: abgelaufener Link im Fragment; `/dashboard.html` ist bewusst das alte Fahrschul-Dashboard).
- **Tastatur**: Tab-Durchlauf je angeklicktem Bildschirm (bis 40 Schritte) in `INTERACTION_AUDIT.csv`, Spalte „Mobil/Keyboard“; die Bestellübersicht hält den Fokus im Dialog (18 Schritte, 0 außerhalb), Escape schließt, der Fokus kehrt zum Auslöser zurück (nur Mock).

## 4. Befunde

### 4.1 Repariert (mit Test)

| Nr | Befund | Reparatur | Beleg |
| --- | --- | --- | --- |
| R1 | **P0**: „Tarif im Detail“ auf der Preisseite tut im Modus ohne Cloud nichts (3 Knöpfe, der Klick ruft ein Sheet auf, das nie eingehängt wird). Auf der gehosteten Vorschau gesehen. | `src/views/preise/PlanGrid.tsx`: Knopf nur, wenn Bestellen möglich ist | `tests/unit/billing.ui.test.tsx` („without cloud …“, 3 Knöpfe weg), `tests/e2e/preise.spec.ts` (mobil und Desktop) |
| R2 | **P0**: Der Antwort-Header `Permissions-Policy: microphone=()` auf jeder Auslieferung sperrt Mikrofon für die App selbst: Assistent mit Sprache und Sprachnotiz funktionieren auf der Seite nicht (an der Vorschau gemessen: `allowsFeature("microphone")` ist `false`). | `netlify.toml` (Repo-Wurzel): `microphone=(self)`, Kamera und Standort bleiben gesperrt | `tests/unit/integration.deploy.test.ts` (Header-Zeile). **Wirkt erst nach der nächsten Auslieferung**; die Vorschau trägt noch den alten Header (8.11., curl) |
| R3 | **P2**: „Übernehmen“ im Handelsplan (eigenes Symbol) kehrt bei leerem Feld still zurück. | `src/views/plan/EntryStep.tsx`: Knopf bei leerem Feld deaktiviert | `tests/unit/views.plan.rules.test.tsx` (deaktiviert bei leerem Feld, aktiv nach Eingabe); `tests/e2e/plan.spec.ts` bleibt grün |

### 4.2 Offen, nach Priorität

| Prio | Befund | Wo / wer |
| --- | --- | --- |
| P1 | **Börsendaten auf der Vorschau**: Der Proxy `/api/binance/*` antwortet mit HTTP 451 („Service unavailable from a restricted location“). Die Antwort stammt von Binance (mit curl nachgemessen), Binance sperrt die Ausgangsadresse des Netlify-Proxys; `netlify.toml` kennt den Fall. Folge: Marktdaten fehlen in der Vorschau, Seiten fangen es mit Leerzuständen ab. | Betreiber: Funktionsregion oder EU-Weg (Blocker 6) |
| P1 | **Abgelaufener Bestätigungslink im Fragment** (`/#error=access_denied&error_code=otp_expired…`, so antwortet der Verify-Endpunkt von Supabase): die App zeigt **nichts**, Besucher landet auf der Übersicht. In der Abfrage-Form (`?error=…`) kommt der Hinweis „Der Link ist abgelaufen. Fordere einfach einen neuen an.“ (ohne Knopf). Nur gegen Mock beobachtet, das echte Verhalten bleibt BLOCKED. | `src/cloud/*` (Paket B, B9) |
| P2 | **Weißer Balken** am unteren Rand jedes Vorschau-Bildschirms (Netlify-Drawer, von der CSP blockiert, trotzdem sichtbar): auf 390 px über der unteren Navigation, fängt Taps (`screens/40-…`, `41-…`). | Betreiber (Blocker 4) |
| P2 | **Betreiber-Satz vor Besuchern**: Konto-Seite ohne Cloud zeigt „Für Betreiber: VITE_SUPABASE_URL …“. | `src/cloud/ui/CloudUnavailableCard.tsx` (B10) |
| P2 | **Statische Dateien**: `/robots.txt`, `/sitemap.xml`, `/favicon.ico`, `/sw.js`, `/.well-known/security.txt` antworten **200 mit der App-HTML** (SPA-Rückfall); `manifest.webmanifest` kommt als `application/octet-stream`. Kein robots.txt, keine Sitemap. | `netlify.toml`, `public/` |
| P2 | **Veralteter Tab nach Neuauslieferung**: fehlt ein Chunk, liefert Netlify HTML mit 200 statt 404; die App zeigt den Fehlerrahmen mit „Neu laden“ (behandelt, kein Datenverlust). | `netlify.toml` (Rückfall nur für Seitenpfade, nicht für `/assets/*`) |
| P2 | **Touch-Ziele auf 390 px**: 82 Treffer unter 44 px, davon einige unter 24 px (WCAG 2.2 AA 2.5.8): Heatmap-Zellen (Analyse, Cockpit), Schalter „Verlauf auf diesem Gerät merken“, „Positionen gruppieren“, „Jetzt aktualisieren“, „CHART ÖFFNEN“, „Antworten vorlesen“. Die Chip-Leiste der Aktien-Seite scrollt waagerecht, Chips außerhalb des Fensters haben keine Trefferfläche. | je Zeile der CSV |
| P2 | **Markt auf allen Viewports**: Der Crawl konnte „Zum Datenarchiv“, „Börsenhistorie nachladen“, „Schwellen einstellen“ nicht klicken (verdeckt/instabil). Von Hand im lokalen Build ohne Marktdaten erscheinen die Knöpfe gar nicht (anderer Zustand). **Belegt dagegen** durch `tests/e2e/archive.spec.ts` (mobil, Desktop; Klick auf „Zum Datenarchiv“ und `squeeze-tune`, Markt-Mock). Ursache des Crawl-Fehlers nicht geklärt. | `src/views/markt/*` |
| P2 | „Übersicht“ im Kopf der leeren Startseite ändert beim Klick nichts Sichtbares (kein Scroll, kein `aria-current`). | `src/app/*` (Startseite, nicht Teil dieses Pakets) |
| P2 | **Intro-Film**: in der Vorschau erst nach 6,8 bis 7,1 s bedienbar (geteilte Sandbox-CPU, auf ruhiger Maschine kürzer); ob es „Überspringen“ gibt, wurde nicht geprüft. | Paket B (B11) |
| P2 | `/?rechtliches=datenschutz` löst vier Navigationen aus (kein Schleifenfall, aber unruhig). | `src/app/*` |

### 4.3 Funde in Bereichen anderer Pakete (nur gemeldet, nicht angefasst)

- **Anmelde-/Registrier-Sheet**: Links „AGB“, „Datenschutzerklärung“, Knopf „Passwort vergessen?“ auf 390 px nur 15 bis 19 px hoch (Zielfläche 16 bis 41 px); die Registrierung nennt die vorgewählte Bestellung nicht (B2); der Bestätigungslink in neuem Tab verliert die Wahl (B1).
- **Bestell-Sheet**: im Mock vollständig und per Tastatur bedienbar (siehe 3), echte Zahlung BLOCKED.
- **Seitenleiste**: Opener „Rechtliches“ bei 390 px nicht vorhanden, bei 1440 px im Crawl nicht auffindbar (Fußzeilenlinks öffnen Impressum, Datenschutz, AGB bei beiden); der Netlify-Balken liegt auf 390 px über der unteren Navigation.
- **Lade-Orb/Teilen-Fächer**: nicht gesondert geprüft.

## 5. Erstbesucher-Sicht (Journey 1 und 2) und Lücken für Paket B

### 5.1 Was ein Erstbesucher in der gehosteten Vorschau sieht

- **Kein Konto möglich.** Die Vorschau ist ein Build ohne Supabase (Modus „lokal“). Der erste Bildschirm ist die App selbst: Übersicht mit dem Leerzustand „Dein Journal ist noch leer“ und dem einen Knopf „Ersten Trade eintragen“, daneben das Badge „Lokaler Modus“. **Es gibt kein „Anmelden“ und kein „Registrieren“.** Journey 1 und 2 sind in der Vorschau nicht ausführbar (BLOCKED durch E1).
- **Keine Landing-Seite.** Weder ein Hero mit „Kostenlos starten“ / „App testen“ noch ein „Premium auswählen“ auf dem ersten Bildschirm. Die Preisseite ist nur über Seitenleiste, Menü oder Funktionen erreichbar.
- **Preise ohne Kauf.** Gelbes Band „Keine Abos in dieser Version – … alle Funktionen sind freigeschaltet“; die Karten tragen keinen Knopf („Noch nicht buchbar“, Free: „Alles freigeschaltet“). Das ist ehrlich, aber der PRO-Hero mit „10 €“ wirkt trotzdem wie ein Angebot. (Die drei „Tarif im Detail“-Knöpfe, die dort nichts taten, sind behoben, siehe 4.1.)
- **Konto-Seite.** „Cloud nicht eingerichtet“ und darunter der Satz „Für Betreiber: VITE_SUPABASE_URL und VITE_SUPABASE_PUBLISHABLE_KEY setzen, dann neu bauen.“ **Eine Betreiber-Anweisung steht damit vor jedem Besucher** (P2, `src/cloud/ui/CloudUnavailableCard.tsx`).
- **Weißer Balken** am unteren Rand jedes Bildschirms (Netlify-Drawer, Blocker 4 in Abschnitt 8).
- **Fußzeile**: Impressum, Datenschutz, AGB öffnen den App-Dialog; das Impressum zeigt „PLATZHALTER Vom Betreiber auszufüllen“ (Blocker 3). Auf 390 px verdeckt keine Sticky-Leiste die Rechtslinks (gemessen am Seitenende von Übersicht, Preise, Konto).
- **Erste Sekunden** (`tests/audit/journeys.spec.ts`, Journey 0, Vorschau): nach 0,6 s läuft ein Intro-Film (Dialog „Intro“ bei 390 und 1440 px), nach 2,5 s noch da; bedienbar erst nach **6,8 bis 7,1 s** (Sandbox mit Last 15 bis 30, auf einem ruhigen Rechner kürzer). Nur einmal je Sitzung (zweiter Aufruf ohne Intro).

### 5.2 Journey 1 und 2 gegen den Cloud-Build mit Supabase- und Billing-Mock

Nur Mock: Mail, Bestätigungslink und Rate-Limits sind nicht echt. Beobachtet an `tests/audit/journeys.spec.ts`, Bilder in `docs/audit/screens/3x-…`.

| Schritt | Ergebnis |
| --- | --- |
| Preise → Monat/Jahr | Jahr zeigt „20 € pro Monat · 240 € jährlich · 2 Monate gratis · spart 48 €“ (Premium); der fällige Jahresbetrag steht nur klein, die Schlagzeile ist das Monatsäquivalent |
| Premium/Jahr wählen (abgemeldet) | Registrierung öffnet; die Wahl (`premium.year.1`) liegt in `sessionStorage` (`tj2-return-to`, 30 Minuten); **der Dialog nennt die gewählte Bestellung nicht** |
| Registrieren mit „keine-mail“ / „abc“ | Eingaben bleiben, Fehler am Feld („Diese E-Mail-Adresse sieht nicht gültig aus“, „Zu kurz“), Passwort-Sichtbarkeit und Stärkebalken vorhanden |
| Absenden (Bestätigung nötig) | „Schau in dein Postfach“, „Erneut senden“ mit Zähler (30 s, nur im Browser; Server-Limit BLOCKED), „Zurück zur Anmeldung“ |
| Bestätigungslink in **neuem Tab** | **Die Bestellung geht verloren**: `sessionStorage` gehört dem Tab, `emailRedirectTo` trägt kein `returnTo`; die App sagt „Öffne den Link am besten in diesem Browser“, nicht „in diesem Tab“ |
| Bekannte E-Mail registrieren | Mock antwortet „Zu dieser E-Mail gibt es schon ein Konto. Melde dich an.“ (Hinweis auf Account-Enumeration, echtes Verhalten BLOCKED); Wechsel zur Anmeldung über „Passwort“ möglich |
| Login aus der Bestellung heraus | Willkommen („Alles synchron“), „Los geht’s“, **danach öffnet sich die Bestellübersicht mit Premium, jährlich, 240 €** (der Rückweg funktioniert, ein zweiter Dialog stapelt sich bewusst nicht) |
| Bestellübersicht per Tastatur | 18 Tab-Schritte, keiner außerhalb des Dialogs (Schließen › Jährlich › Tarif im Detail › Felder › AGB › Widerrufsbelehrung › Datenschutz › Abbrechen › „Zahlungspflichtig bestellen“), Escape schließt, der Fokus kehrt auf den Auslöser zurück (nur Mock) |
| Kauf abbrechen | Escape schließt, Tarif bleibt „Free“, die App bleibt nutzbar |
| „Kostenlos starten“ | Registrierung öffnet; Konto ohne Bestätigungspflicht (Mock) → Willkommen → Übersicht mit Leerzustand |
| Nach dem ersten Login | **Kein Mini-Onboarding, keine Demo-oder-eigene-Daten-Frage, kein Wizard**; nur der Leerzustand mit „Ersten Trade eintragen“ und ein Satz, dass Einführung und Demo „später unter Einstellungen und Funktionen“ liegen |
| Passwort vergessen | Link senden → „Schau in dein Postfach“, gleiche Antwort für unbekannte Adresse (Mock; echte Enumeration-Freiheit liegt bei Supabase = BLOCKED) |
| Falsches Passwort | „E-Mail oder Passwort stimmt nicht.“, E-Mail bleibt im Feld; Rate-Limit nach mehreren Versuchen BLOCKED |
| Abgelaufener Bestätigungslink | Abfrage-Form (`/?error=access_denied&error_code=otp_expired…`): Toast „Anmeldung nicht möglich · Der Link ist abgelaufen. Fordere einfach einen neuen an.“, ohne Knopf; **Fragment-Form (`/#error=…`), wie sie der Verify-Endpunkt von Supabase liefert: keine Rückmeldung** (nur Mock, echtes Verhalten BLOCKED) |

### 5.3 Lücken, priorisiert (Umsetzung übernimmt Paket B)

| Prio | Lücke | Wo | Hinweis |
| --- | --- | --- | --- |
| P0 | B1: Die vorgewählte Bestellung überlebt den Bestätigungslink nicht, sobald er in einem anderen Tab/Browserfenster geöffnet wird | `src/store/returnTo.ts` (`sessionStorage`, `RETURN_TTL_MS` 30 min), `src/cloud/client.ts` (`redirectUrl()` ohne `returnTo`) | `?returnTo=order:premium.year.1` kennt der Router schon (`parseReturnParam`, validiert, kein offener Redirect): in `emailRedirectTo` mitgeben, in Supabase die Redirect-URL mit Muster erlauben (Betreiber) |
| P0 | B2: Die Registrierung sagt nicht, was gewählt wurde („Premium · jährlich · 240 €“, „Wahl bleibt erhalten“, „Ohne Kauf weiter im kostenlosen Bereich“) | Anmelde-Sheet (Bereich anderer Agenten) | reine Textzeile über den Feldern, Daten stehen im `returnTo` |
| P0 | B3: Keine Landing-/Preis-Einstiegsseite mit CTAs für Erstbesucher; erster Bildschirm ist die leere Übersicht; „App testen“, „Funktionen ansehen“ fehlen | Shell | Übersicht und Cockpit bleiben unverändert (Auftrag); eine eigene Einstiegsseite vor der App oder ein Hero nur für Besucher ohne Daten |
| P1 | B4: Vorschau ohne Supabase: Journey 1/2 nicht ausführbar | Netlify-Variablen | Blocker 1; bis dahin Cloud-Build gegen den Mock als Ersatz-Beleg |
| P1 | B5: Kein Einrichtungs-Wizard (Konto → Demo/eigene Daten → Verbindung optional → erster Trade), kein gespeicherter Fortschritt, nichts nach dem ersten Login | `src/onboarding/*` (Tour mit 6 Schritten existiert, startet nur auf Wunsch) | „Demo“ und „Echt-Daten“ sind getrennte Wege (Demo-Chunk existiert); Start-Empty-States gibt es („Dein Journal ist noch leer“) |
| P1 | B6: CTA-Beschriftungen weichen vom Auftrag ab: „Weiter zur Bestellung“ statt „Premium auswählen“ (abgemeldet) / „Weiter zur Zahlung“ (angemeldet); „Abo verwalten“ klickbar auf dem eigenen Tarif statt „Dein aktueller Tarif“ (nicht klickbar); „Wechseln“ statt „Zu Premium wechseln“ | `src/views/preise/strings.ts`, `PlanGrid.tsx` | Rechtlich wichtige Beschriftung der Bestell-Schaltfläche („Zahlungspflichtig bestellen“) hat Vorrang und bleibt |
| P1 | B7: Jahreskarte zeigt das Monatsäquivalent als Schlagzeile, der tatsächlich fällige Jahresbetrag steht klein | `PlanGrid.tsx` (`PriceBlock`) | Auftrag verlangt den fälligen Jahresbetrag |
| P1 | B8: Preisseite ohne Kontakt zum Support und ohne Hinweis auf Zusatzkosten (KI, Telefonie, Anbieter), FAQ nennt sie nicht | `PricingFaq.tsx`, `strings.ts` | Auftrag Abschnitt 3 |
| P1 | B9: Abgelaufener Link im Fragment wird nicht angezeigt; in der Abfrage-Form fehlt der Knopf „Neuen Link senden“; „Erneut senden“ hat nur einen Zähler im Browser | `src/cloud/ui/AuthSheet.tsx`, `src/cloud/client.ts` | Serverseitiges Limit ist Supabase-Einstellung (Betreiber) |
| P2 | B10: Konto-Seite zeigt Besuchern „Für Betreiber: VITE_SUPABASE_…“ | `CloudUnavailableCard.tsx` | Satz nur im Betreiber-Status oder bei `?debug` |
| P2 | B11: Intro-Film bis zur Bedienbarkeit 2,5 bis 7 s; kein geprüfter „Überspringen“-Knopf | Intro der Shell | gemessen auf belasteter Sandbox |

## 6. Welle A bis D: geprüft gegen behauptet

Quelle der Behauptungen: `docs/LAUNCH-PLAN.md`, `docs/PRODUKTABGLEICH.md` (07.11.), `docs/ABNAHME-40.md`. **Keine Fertigmeldung wurde übernommen**; die Spalte „in diesem Audit gesehen“ nennt nur, was ich im Browser selbst gesehen oder gemessen habe.

| Welle | Behauptet | In diesem Audit gesehen | Offen oder blockiert |
| --- | --- | --- | --- |
| A Fundament | Tarifvertrag, Screenshot-Originale, Zeitmaschine, Suche bis zur Aufgabe, Motion, Button-Familie, Funktionen-Seite, UX-Matrix (alles ohne Betreiberzugang) | Preisseite mit vier Tarifen und den Preisen 0/12/24/19 €, Jahr 0/120/240/190 € (Cloud-Build, Mock-Konfiguration); Funktionen-Seite mit Suche (197 Einträge) und Gruppen; Menü mit Suchfeld; kompakte Seitenleiste ab 768 px; Trade-Formular öffnet (nur angesehen); Bundle-Budget gemessen | Pixelvergleich Übersicht/Cockpit und Playwright-Clips sind nicht im Repo; 10.000-Pfade-Canvas, Screenshot-Hash, Backup-Restore wurden hier nicht ausgeführt (E2E-Specs der CI) |
| B Konto, Verbindungen, Kauf | Konto, Binance-Key-Weg, TradingView-Empfänger, Kaufstrecke (Bestellübersicht, Stripe, Ergebnis, Portal, Kündigung/Widerruf ohne Login) | Registrieren, Anmelden, Passwort vergessen, Bestätigungs-Zustand mit Zähler, Bestellübersicht „Deine Bestellung“ (Premium, jährlich, 240 €), Rückkehr zur Bestellung nach dem Login im selben Tab: **alles gegen Mock** | **BLOCKED** bis Supabase (E1) und Stripe (E2) laufen; Binance (E3) und TradingView (E4) nie live geprüft |
| C Fachkette und Betrieb | Branchen-Papierposition, vier Alarme mit Telefon, Wal-Karte, Betrieb (Release-Check, Notaus, Restore-Probe) | Seiten laden, Overlays öffnen (Markt, Aktien, Risiko, Analyse …); in der Vorschau liefern die Datenfunktionen `industry/daily`, `congress/index`, `stocks/symbols`, `klines` HTTP 200 | Marktfeeds im Browser der Sandbox: Binance/Bybit/OKX HTTP 451 oder CORS; der Same-Origin-Proxy der Vorschau antwortet ebenfalls 451 (Binance sperrt die Netlify-Ausgangsadresse, mit curl nachgemessen); Twilio, Resend, Alarm-Cron nie live |
| D Abnahme | 40-Punkte-Protokoll, Matrizen, Startentscheidung | Protokoll liegt vor und ist ehrlich („nur Mock“); **dieses Audit bestätigt NO-GO** | Geräte (E7), Anwalt (E9), Produktivprojekte, ruhige Messmaschine |

## 7. QA-Fälle (`QA_RELEASE_TESTS.csv`), soweit dieses Audit sie berührt

Status nach Auftrag: PASS nur mit echtem Beleg; Mock-Belege stehen als „nur Mock“, fehlende Zugänge als BLOCKED. Die vollständige Ergebnisdatei (`RELEASE_TEST_RESULTS.csv`) gehört nicht zu diesem Paket.

| ID | Status | Beleg oder Grund |
| --- | --- | --- |
| VIS-01 | **FAIL** (Teil) / PASS (Teil) | Es gibt keine Landing-Seite; die CTAs „Kostenlos starten“, „Weiter zur Bestellung“ auf der Preisseite öffnen das richtige Ziel (Registrierung bzw. Bestellung, nur Mock), keine Platzhalter-Links. Siehe Abschnitt 5 |
| VIS-02 | PASS | 0 Links mit `#` oder leerem Ziel im Quelltext und im Browser; Fußzeilen-Links (Impressum, Datenschutz, AGB, Kündigen) öffnen ihr Ziel; Hash-Ziele der Seitenleiste alle bekannt |
| VIS-03 | PASS (nur Mock-Konfiguration der Preise) | Vier Tarife mit Inhalten (Cloud-Build gegen Billing-Mock) |
| VIS-04 | PASS (nur Mock) | Monat/Jahr schaltet Preise und Hinweise um; Jahreskarte zeigt Monatsäquivalent groß und „240 € jährlich“ klein (siehe 5, B7) |
| VIS-05 bis VIS-07 | **BLOCKED** | Checkout-Betrag gegen Stripe nicht prüfbar; Bestellübersicht zeigt gegen Mock 240 € |
| VIS-08 | BLOCKED | Abgleich mit Server-Entitlements braucht das echte Backend |
| AUTH-01, AUTH-04, AUTH-05 | **BLOCKED** | echte Zustellung und Bestätigungslink brauchen Supabase + SMTP |
| AUTH-02 | PASS (UI) | ungültige E-Mail/zu kurzes Passwort: Eingabe bleibt, Fehler am Feld |
| AUTH-03 | nur Mock | der Mock antwortet „Zu dieser E-Mail gibt es schon ein Konto“; das ist eine Account-Enumeration, ob Supabase ebenso antwortet, ist **BLOCKED** (echte Einstellung) |
| AUTH-06 | **FAIL** | Tarifwahl geht beim Öffnen des Bestätigungslinks in einem neuen Tab verloren (Abschnitt 5, B1) |
| AUTH-07 bis AUTH-11 | BLOCKED | Session, Rate-Limit, Reset-Mail, Export/Löschung gegen echtes Projekt |
| UI-01 | PASS mit offenen P2 | Crawl-Ergebnis in Abschnitt 3; nicht alle Elemente auf allen Viewports angeklickt |
| UI-02 | nur Mock | Zustände von Knöpfen sind in den Unit-Tests belegt; Erfolg/Fehler gegen echte Operation BLOCKED |
| UI-06 | PASS mit offenen P2 | 390/768/1280/1440 px: kein horizontaler Überlauf; Treffer unter 44 px auf 390 px siehe Abschnitt 3 |
| UI-07 | teilweise | Tab-Durchlauf und Bestellübersicht per Tastatur gemessen (Abschnitt 5); kein Screenreader-Test, kein Gerät |
| UI-08 | nicht neu ausgeführt | `tests/e2e/motion-global.spec.ts` der CI; in diesem Audit nicht wiederholt |
| PERF-02 | PASS | JS 654,9 / 800 KiB, CSS 51,9 / 52 KiB (`npm run budget`, sauberer Build) |
| SEC-01 | PASS (Teil) | Musterprüfung der gebauten Bundles: kein Schlüssel; die Treffer sind Abweisungs-Code (`sb_secret_` wird im Browser abgelehnt); Header der Vorschau: CSP, HSTS, `nosniff`, `X-Frame-Options: DENY`, Referrer-Policy vorhanden. Microphone-Header war falsch (Abschnitt 4.1) |
| DATA-*, BILL-*, TRADE-05 bis -10, CONN-*, OPS-*, LEGAL-*, REL-* | BLOCKED oder nicht Teil dieses Audits | brauchen Betreiberzugänge, Live-Dienste oder gehören zu anderen Paketen |

## 8. Exakte Blocker: Verantwortlicher und kürzester Weg

Alles in dieser Liste steht ausführlich in `docs/BETREIBER-AUFGABEN.md` und `SETUP.md`; hier nur, was das Audit **gemessen** hat und was der kürzeste Weg ist.

| Nr | Blocker | Verantwortlich | Kürzester Weg | Messung |
| --- | --- | --- | --- | --- |
| 1 | Kein Supabase-Produktionsprojekt (E1) | Betreiber | Projekt in Frankfurt anlegen, `VITE_SUPABASE_URL`, `VITE_SUPABASE_PUBLISHABLE_KEY`, `SUPABASE_URL`, `SUPABASE_SECRET_KEY` in Netlify, Migrationen 0001 bis 0019, „Confirm email“ an, SMTP, Redirect-URLs (die Muster der Deploy-Previews eingeschlossen, sonst trägt der Bestätigungslink nirgends hin) | Vorschau: Konto-Seite „Cloud nicht eingerichtet“, kein „Anmelden“; `GET /api/v1/billing/status` → `500 server_misconfigured` |
| 2 | Kein Stripe-Konto (E2) | Betreiber, Steuerberater | Testmodus: drei Produkte mit sechs Preisen, `STRIPE_*`, Webhook mit den elf Ereignissen, Kundenportal; Steuerentscheidung | Preisseite der Vorschau: „Keine Abos in dieser Version“, paid Karten „Noch nicht buchbar“ |
| 3 | Rechtstexte, Impressum (E9) | Betreiber, Anwalt | `VITE_LEGAL_*` setzen, Texte prüfen lassen | Impressum der Vorschau zeigt „PLATZHALTER Vom Betreiber auszufüllen“; Kaufstrecke ist ohne diese Angaben absichtlich gesperrt |
| 4 | Netlify Deploy-Preview-Drawer | Betreiber (Netlify-Einstellung) | Drawer für Deploy-Previews abschalten oder `frame-src https://app.netlify.com` nur für Previews erlauben (Einstellung in der aktuellen Netlify-Oberfläche prüfen) | Auf **jedem** Bildschirm der Vorschau liegt ein weißer Balken (780 × 48 px) am unteren Rand: die Netlify-Leiste (`/.netlify/scripts/cdp`, iframe von `app.netlify.com`), von der CSP (`frame-src 'none'`) blockiert und trotzdem sichtbar; auf 390 px überlagert er die untere Navigation und fängt Taps (`docs/audit/screens/40-…`, `41-…`) |
| 5 | Resend, Twilio (E5) | Betreiber | Konten, Domain, Nummern, Verify-Dienst | nie live |
| 6 | Binance (E3), TradingView (E4) | Betreiber, Anbieter | Key-Weg mit fester Ausgangs-IP bzw. Fast-API-Antrag; TradingView ab Essential und Klärung der Nutzungsbedingungen | `GET /api/binance/fapi/v1/time` auf der Vorschau → HTTP 451 mit Binance-Text „restricted location“ (nicht nur Sandbox-Browser) |
| 7 | Echte Geräte (E7) | Betreiber | BrowserStack oder ein Android-Tablet mit Testkonto | nicht vorhanden |
| 8 | Zwei echte Testkonten, Sandbox-Zahlungen | Betreiber nach 1 und 2 | zwei Konten anlegen, Stripe-Testkarte `4242 …` | alle DATA-, BILL-, AUTH-Fälle der QA-Liste bleiben bis dahin BLOCKED |
| 9 | Tarif-Kontingente und Logo (E8, E10) | Betreiber | Zahlen in `docs/TARIFE.md` freigeben, Logo als SVG-Pfad | stehen als Vorschlag im Code |

## 9. Wiederholen

```
cd trading-journal && npm ci
npm run build && npx vite preview --host 127.0.0.1 --port 4410 &           # Default-Build
npm run build:e2e-cloud && npx vite preview --outDir dist-e2e-cloud --host 127.0.0.1 --port 4411 &   # Cloud-Build gegen den Supabase-Mock
PW_AUDIT_OUT=/tmp/audit PW_AUDIT_LOCAL=http://127.0.0.1:4410 PW_AUDIT_CLOUD=http://127.0.0.1:4411 \
PW_AUDIT_PREVIEW=https://deploy-preview-6--xxhuxabbyubzv.netlify.app \
  npx playwright test -c playwright.audit.config.ts              # Crawl + Journeys + Adressen + Namen (eigener Lauf, nicht Teil der CI)
# Cloud-Personen schnell (nur Kernbildschirme): PW_AUDIT_ONLY=cloud-out,cloud-in PW_AUDIT_SCREENS=overview,preise,konto,settings,overlay-auth-login,overlay-auth-signup,overlay-bestellung,overlay-tarifdetail PW_AUDIT_TAG=cloud
node scripts/audit/buildAuditCsv.mjs /tmp/audit --out docs/audit   # INTERACTION_AUDIT.csv und evidence/summary.json
```

Umgebung: `PW_AUDIT_ONLY=local,cloud-in` (Personas), `PW_AUDIT_VIEWPORTS=390,1440`, `PW_AUDIT_SCREENS=preise,overview` (Bildschirme), `PW_AUDIT_TAG=recheck` (Teil-Lauf, ersetzt die gleichen Bildschirme des Vollaufs), `PW_AUDIT_WORKERS`. Manuelle Urteile stehen in `scripts/audit/annotations.json`.

## Nachtrag nach dem Zusammenführen (Hauptagent, 2026-11-08)

Dieser Bericht entstand auf dem Stand 13bbb7d, also vor Paket B (Anmeldung/Bezahlen). Beim Zusammenführen gilt:
- **Durch Paket B behoben (Code + Tests, nur gegen Mocks belegt):** B1 (Tarifwahl über `?order=` im Bestätigungslink, 60-Minuten-Notiz auch in localStorage), B2/B5 (Bestellkontext in der Registrierung, CTA-Beschriftungen), B4 teilweise (Vorschau ohne Supabase bleibt wie sie ist), B6 (Einrichtungs-Assistent), B7 (Jahresbetrag statt Monatsäquivalent als Schlagzeile, "Heute 0 EUR … danach 120 EUR pro Jahr"), AUTH-03 (neutrale Registrierungsantwort).
- **Weiter offen:** B3 (keine eigene Landing-/Einstiegsseite), B8 (Hinweis auf Zusatzkosten), B9 (Link-Ablauf im URL-Fragment), alle P1/P2-Punkte dieses Berichts, und alles, was echte Dienste braucht.
- **Urteil unverändert: NO-GO.**

## Nachtrag Runde 13 (2026-11-10): offene Funde abgearbeitet, Bewegung nachgemessen

Basis: `5fa335a3` (PR #6) plus die Commits von PR #7 (`claude/exciting-planck-hc1c7u`). **Urteil unverändert: NO-GO**, weil die Freigabebedingungen aus Abschnitt 1 an Betreiber-Zugängen, Geräten und dem Anwalt hängen. Was sich geändert hat:

**Behoben (Code + Test, im Browser am gebauten Stand nachgeprüft):**

| Fund (Abschnitt) | Was jetzt gilt | Beleg |
| --- | --- | --- |
| P1 abgelaufener Bestätigungslink im Fragment (4.2, B9) | Beide Formen (`/?error=…` und `/#error=…`) öffnen das Magic-Link-Formular, der Grund steht dort sichtbar („Der Link ist abgelaufen. Fordere einfach einen neuen an.“). Ursache war, dass der Hash-Router die Adresse umschrieb, bevor der Fehler gelesen wurde; er wird jetzt beim Laden gemerkt. | `src/cloud/callbackUrl.ts`, `src/cloud/ui/AuthSheet.tsx`; `tests/unit/cloud.callbackUrl.test.ts`, `tests/unit/cloud.authB.test.tsx`; Browser: Cloud-Build, beide Adressen |
| P2 Betreiber-Satz vor Besuchern (4.2, B10) | Nur noch im Dev-Server oder mit `?debug` | `src/lib/operatorHints.ts`; `tests/unit/lib.operatorHints.test.ts`; Browser: `#konto`, `#community` |
| P1 Preisseite ohne Zusatzkosten und Support (5.3, B8) | Zwei FAQ-Einträge | `src/views/preise/strings.ts`; Browser: `#preise` |
| P2 statische Dateien (4.2) | `robots.txt` und `favicon.ico` sind echte Dateien, das Manifest kommt als `application/manifest+json`, fehlende Dateien unter `/assets/*`, `/teilen/assets/*`, `/ocr/*`, `/icons/*`, `/sitemap.xml`, `/sw.js`, `/.well-known/*` antworten mit 404 statt mit der App-HTML | `netlify.toml`, `public/`; `tests/unit/integration.deploy.test.ts`; an der Vorschau von PR #7 mit curl gemessen (robots 200 text/plain, `/assets/nope.js` 404, Manifest-Typ, sitemap 404) |
| P2 weißer Balken der Netlify-Vorschau (4.2, Blocker 4) | In der App ausgeblendet (`index.html`); an der Vorschau von PR #7 bei 390 px gemessen: `display: none` | `tests/unit/security.clientInput.test.ts` |
| K7 Fehlerrahmen für nachgeladene Teile | `FeatureHosts` und `BillingBanner` laden mit Wiederholung und haben eigene Rahmen | `src/App.tsx` |
| neu gefunden: Schließen-✕ des Bezahlfensters auf dem Handy | war weiß auf weißem Papierkopf (praktisch unsichtbar, dort der einzige Weg hinaus); jetzt dunkle Tinte in beiden Themen | `payWindow.css`; `tests/unit/motion.round13.test.tsx`; Browser 390 px |
| neu gefunden: Einrichtungs-Assistent „Zurück“ | der gehende Schritt lief in die falsche Richtung | `SetupWizard.tsx`; `tests/unit/onboarding.wizard.test.tsx`; Browser bildweise |

**Nachgezogen (Stand der Dokumente):** AUTH-03 und AUTH-06 standen in `RELEASE_TEST_RESULTS.csv` noch als FAIL, obwohl Paket B sie behoben hat; beide sind nachgeprüft und stehen als PASS (26 PASS, 0 FAIL, 43 BLOCKED). `PRODUKTABGLEICH.md`: K7, K14, K15 fertig, K16 auf dem Stand der Mikrofon-Richtlinie.

**Nachgemessen, kein Befund:** „`/?rechtliches=datenschutz` löst vier Navigationen aus“ (4.2) sind drei Änderungen der Adresse im selben Dokument (Router normalisiert den Hash, der Rechtstext-Host nimmt den Parameter aus der Adresse, der Dialog legt einen Verlaufseintrag an, damit „Zurück“ ihn schließt); die Seite lädt nicht neu. Der Intro-Film (B11) hat „Überspringen“, Esc, Enter, Leertaste und Klick und läuft einmal je Sitzung.

**Bewegung:** siehe `docs/ANIMATIONEN-MATRIX.md`, Abschnitt „Runde 13 – Bewegungsprüfung“ (Bezahlfenster, Assistent, Grundlagen-Karten, Suche, nachgeladene Karten).

**Weiter offen (nicht in dieser Runde):**

- K1: Die Einstellungsseite wächst bei 1024 bis 1279 px nach dem Laden. Nachgemessen: die reservierten Höhen stammen von 1280/1440 px, bei 1024 px sind „Live-Daten“ und „Einstiegs-Check“ deutlich höher. Die Kartenhöhen hängen von den Marktdaten ab, die diese Umgebung nicht erreicht (451), deshalb hier nicht verlässlich einstellbar.
- B3: keine eigene Landing-Seite. Seit der Konto-Pflicht ist das Anmeldefenster der erste Bildschirm (mit „Preise ansehen“); mehr ist eine Produktentscheidung.
- Touch-Ziele unter 44 px (4.2): die genannten Schalter tragen `touch-hit` (44 × 44 px auf Touch-Geräten); die Messung des Crawls hat die Trefferfläche nicht mitgezählt. Heatmap-Zellen bleiben klein. Am echten Gerät zu bestätigen.
- Gewinn-Konfetti beim Speichern eines Trades: unverändert Entscheidung des Betreibers (`docs/PSYCHOLOGIE.md`, Abschnitt 6, Punkt 1).
- Impressum der Vorschau zeigt weiter „PLATZHALTER“ (Betreiber setzt `VITE_LEGAL_*`); der Kauf bleibt dort deshalb gesperrt (`purchaseBlockedBy: legal`, an `/api/v1/billing/status` der Vorschau gemessen).
- Alles aus Abschnitt 8 (Supabase-Produktion, Stripe live, Binance 451, TradingView, Resend/Twilio, Geräte, Anwalt).

**Geprüft in dieser Runde:** Typprüfung und Lint sauber; Unit-Tests 670 Dateien / 9.689 grün (CI auf `f433d3ef`); E2E in der CI auf `f433d3ef`: alle vier Teile grün; Budget JS 662,2 / 800 KiB, CSS 52,5 / 52,5 KiB. Nicht geprüft: echte Geräte, echte Dienste.

