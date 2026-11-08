# Paket B – Vorbild-Videos für Anmeldung/Registrierung und Bezahlfenster

Stand: 08.11.2026 (Runde 12, Paket B). Quelle: die Bildschirmaufnahmen des Nutzers (`/root/.claude/uploads/…`), jeweils per `ffmpeg` in Bilder zerlegt
(`fps=3` Übersicht über alle, `fps=4–5` mit zugeschnittener Komponente für die zwei Hauptvorlagen) und Bild für Bild angesehen. **Kein Quelltext der Vorlagen wurde
eingesehen oder übernommen** – die Videos zeigen Verhalten, keinen Code. „Übernehmen“ heißt hier eine Gestaltungs- und Verhaltensidee, im eigenen Token-System neu gebaut
(Anthrazit, Glas, Punktschrift, Signalrot nur auf der Primäraktion). Der Nutzer hat die zwei Hauptvorlagen ausdrücklich bestätigt: **„so nachbauen, nur in unserem Style“.**

## Welche Videos zeigen was

15 hochgeladene Dateien sind nur **8 verschiedene Aufnahmen** (gleiche MD5-Summe: `…002523` ×3, `…002630` ×3, `…002648` ×2, `…002429` ×2, `…154232` ×2).
Die Zuordnung im Auftragstext (`launch-brief.md`) war an zwei Stellen verrutscht; so ist es nach den Bildern:

| Datei (Kürzel) | Länge | Was zeigt es | Paket |
|---|---|---|---|
| `5a853439` = `5f9b2e21` = `f6479a3d` (`…002523_Instagram`) | 6,4 s | **„Login & Signup Animation“** (Komponente 91, code_and_chill_, Marke „VERSO“) – **Anmeldung / Registrierung** | **B** |
| `7f13a0a4` = `f1aeb13a` (`…002648_Instagram`) | 6,6 s | **„Payment Method Animation“** (Komponente 90, Marke „SABLE“) – **Bezahlen** | **B** |
| `43325949` (`…20261107_004711_Chrome`) | 5,1 s | „Thinking Orbs“ (libraries.dev): Punktkugeln „Searching… / Solving… / Agent planning…“ – **Ladezustand** (nicht „Glassy SideBar“, wie im Auftragstext) | C/D (hier genutzt: Wartering der Zahlung, `ThinkingOrb plan`) |
| `e89d84e9` (`…20261107_005143_Chrome`) | 5,1 s | „Voice Ring“ (libraries.dev): leuchtender, weich verformter Ring, Listening/Speaking, Processing, Mono | C/D (hier nur die Idee „ruhiger Halo-Ring“) |
| `35838226` = `f79f88c2` (`…20261101_154232_Instagram_1`) | 8,5 s | „Glassy SideBar V5“ (code.xr): Schiene ↔ breites Glas-Panel | Seitenleiste (anderes Paket) |
| `2828376d` = `685ba048` (`…002429_Instagram`) | 5,5 s | „Share Button Animation“ (Radial Share) | Teilen (anderes Paket) |
| `a34f978e` = `ca944779` = `f7c7216a` (`…002630_Instagram`) | 9,1 s | „Delete Button – The Bin Eats The Label“ | Löschen (anderes Paket) |
| `03f073bb` (`…20261030_235420_Instagram`) | 10,3 s | textura.eu „How I make sites like this in 5 minutes“: Relay-Landingpage mit Limetten-Übergängen | keines von B |

## Video 1 – Login & Signup Animation (`5a853439`) → `src/cloud/ui/AuthBlade.tsx`

**Bildfolge (5 Bilder/s, Komponente zugeschnitten):**

| Zeit | Zustand |
|---|---|
| 0–1,4 s | Ruhe: Karte zweigeteilt – links hell das Formular („Sign in“ mit Unterstreichung in der Akzentfarbe, „Username or email“ und „Password“ mit Symbol rechts im Feld, Haken „Keep me signed in“, Link „Forgot password?“, Knopf „Sign in“, darunter „New to … ? Create account“), rechts dunkelgrün die Begrüßung „Welcome back.“ |
| ≈ 1,5 s | Klick auf „Create account“: eine **schräge Kante fährt über die Karte** (goldene Haarlinie an der Kante) |
| ≈ 1,7 s | kurz **alles dunkel**, die Begrüßung „Start the first page.“ blendet **auf der jetzt vertauschten Seite** ein |
| ≈ 1,9 s | Formular „Create account“ steht fertig da, **Cursor im ersten Feld** (Fokus-Unterstreichung goldfarben), Hilfetext „Use 8 characters or more.“ am Passwortfeld |
| später | „Already have an account? Sign in“ läuft denselben Wechsel rückwärts (kurzer Punkte-Lader auf dunkler Fläche) |

| | |
|---|---|
| **Übernommen – Struktur** | **Eine** Karte, **zwei Gesichter** statt zweier Seiten; der Wechsel steht in der Karte selbst („Neu hier? Jetzt registrieren“ ↔ „Schon registriert? Zur Anmeldung“); ein Markenstreifen mit **eigenem** Namen und einem Satz je Schritt statt der Fremdmarke („TRADE JOURNAL“ in Doto-Punktschrift, „Willkommen zurück.“ / „Dein Journal. Dein Start.“ …); schräge Unterkante des Streifens als Hinweis auf die Diagonale; Hilfetext zur Passwortregel **am Feld**. |
| **Übernommen – Bewegung** | **EIN Band fährt EINMAL über die ganze Karte, der Inhalt wechselt hinter dem Band**, danach Ruhe; der Fokus landet im ersten Feld; kein Layoutsprung (die Karte behält ihren Kasten, das Band ist ein reines `transform`-Overlay, das die Seite nicht berührt). |
| **Timing** | Original ≈ 0,4–0,5 s vom Klick bis zum fertigen Formular. Unser Band braucht **560 ms** insgesamt (es deckt Markenstreifen *und* Formular), der Inhalt wechselt bei **46 % = 257 ms**, danach ≈ 300 ms bis das Band die Karte verlassen hat. Danach arbeitet das vorhandene Feldgleiten (`AuthMorph`, `spring.layout` / `spring.enter`). Zeitgeber – nicht die Animation – entscheiden über Wechsel und Ende (ein versteckter Tab pausiert Frames; sonst bliebe die Karte hängen). Ein zweites Umschalten während des Bandes wird ignoriert. |
| **In unserem Material** | Dunkles Glasband (95 % `ink-900`, bewusst ohne `backdrop-filter`: bei 95 % Deckung nicht zu sehen, aber teurer Bildaufbau) mit **feiner Lichtkante auf beiden Seiten** statt Grün/Creme; Rot **nur** auf dem einen Primärknopf der Karte; Schrift Plex + Doto, keine Serifen. |
| **Reduced Motion** | Kein Band, **sofortiger Wechsel**, der Claim wechselt sofort, der Fokus landet trotzdem im ersten Feld; nichts bleibt unsichtbar. |
| **Nicht übernommen (mit Grund)** | Cremeweiß/Dunkelgrün-Zweiteilung, goldener Akzent, Serifenschrift (anderes Markendesign, eine Akzentfarbe gilt); **„Keep me signed in“** (unser Login hält die Sitzung immer – der Haken wäre ein Schein-Schalter ohne Wirkung, laut Auftrag keine Attrappen); **„Full name“** (wir fragen nichts, was wir nicht brauchen); die Fremdmarke VERSO. |
| **Beide Formulare validieren echt** | wie im Original, und mehr: Feldfehler am Feld mit Fokus (`Field invalidKey`), Fehler verschwindet, sobald die Eingabe stimmt, Passwort-Sichtbarkeit (`aria-pressed`), Passwortregel am Feld (10 Zeichen) + Stärke, **keine Konto-Abfrage** bei der Registrierung (gleiche Antwort für neue und vorhandene Adresse), Offline-Hinweis vor dem Absenden, Tastatur-Submit (`<form>`), „E-Mail nicht bestätigt“ → Mail-Schritt mit sofort verfügbarem „Erneut senden“. |

## Video 2 – Payment Method Animation (`7f13a0a4`) → `PlanCardArt.tsx`, `PayStage.tsx`, `OrderSheet.tsx`

**Bildfolge (4 Bilder/s):** Oben ein Schrittband „Your bag ✓ – Delivery ✓ – Payment“. Links eine **Kartengrafik**, rechts „Payment details“ (Karteninhaber, Kartennummer mit „VISA“-Hinweis,
Ablauf, CVC). Beim Tippen der Nummer erscheinen die Ziffern **gleichzeitig auf der Karte**, Gruppen füllen sich, Platzhalter-Punkte; der Ablauf bekommt den Schrägstrich automatisch.
**Fokus auf CVC → die Karte dreht sich um die Hochachse (≈ 0,35 s)** und zeigt Magnetstreifen + Prüfziffer. Darunter „Your order … $1,180.00“. Klick auf „Pay $1,248.00“ → die Karte
**fährt in die Mitte und füllt die Fläche** (≈ 0,4 s), blauer Schein, „**Authorizing with your bank**“ (≈ 1 s), dann **grüner Schein** und „**Paid $1,248.00**“ mit Beleg-Hinweis, danach Rücksetzen.

**Der entscheidende Unterschied – Wahrheit und Sicherheit:** Unsere Zahlung läuft über die **offizielle Stripe-Checkout-Seite** (Weiterleitung). Wir verarbeiten und speichern **nie** Kartennummern.
Darum übersetzen wir das Live-Karten-Erlebnis so:

| Vorlage | Bei uns |
|---|---|
| Kartengrafik zeigt live, was eingegeben wird | **Plan-Karte der Bestellübersicht** (`PlanCardArt`, vorher Stripe): zeigt die gewählte **Auswahl** – Tarif, Intervall, Sitze, den fälligen Betrag – und folgt jeder Änderung live (Monat ↔ Jahr, Sitze). Eine reine Visualisierung: `aria-hidden`, **kein einziges Eingabefeld in ihr**, darunter der Satz „Darstellung deiner Auswahl – hier wird keine Karte eingegeben. Gezahlt wird auf der Seite von Stripe.“ |
| Karte dreht sich beim CVC-Fokus (Rückseite mit Magnetstreifen) | Die Karte **dreht sich per Knopf** („Karte umdrehen: Das ist enthalten“, `aria-pressed`): 3D-Wende (`perspective`, `preserve-3d`, `backface-visibility: hidden`, `spring.smooth`), die **Rückseite zeigt, was der Tarif enthält** (3–4 Zeilen aus dem Tarifvertrag). |
| Schrittband Bag · Delivery · Payment | **Ablaufband** „Bestellung prüfen · Zahlung bei Stripe · Bestätigung“; Schritt 3 wird in diesem Fenster **nie** erreicht (erst die Ergebnisseite nach Serverbestätigung). |
| Betrag neben „Pay …“ | **Summe in der Fußzeile neben dem Kaufknopf** („Gesamt 240 € pro Jahr“); der Kaufknopf behält die gesetzlich festgelegte Beschriftung **„Zahlungspflichtig bestellen“** (§ 312j Abs. 3 BGB, Entwurf – Anwalt prüft). |
| Klick → Karte füllt die Fläche, „Authorizing with your bank“ | **PayStage**: nach dem Klick legt sich über die (inerte) Zusammenfassung eine ruhige Glasfläche – Karte mit **Halo-Ring** (weiß/neutral, 3 Atemzüge, dann Ruhe), `ThinkingOrb plan` („wartet auf Dritte“), „Wir bereiten deine Zahlung bei Stripe vor …“ → „Weiter zu Stripe – dort zahlst du.“, Betrag, Verlängerung und der Satz „Gebucht ist erst, wenn Stripe die Zahlung bestätigt hat“. Das Fenster behält seine Größe (gemessen ≤ 2 px Unterschied). |
| Kaufknopf Idle → Laden | Kaufknopf **Idle → „Wird vorbereitet …“ → „Weiter zu Stripe …“** in **einer** Grid-Zelle (Breite fix, kein Layoutsprung), Doppelklick-Schutz bleibt (`phase` + Idempotenzschlüssel `orderId`); Fehler → Stage weg, Auswahl und Kästchen unverändert, `role="alert"` + „Nichts wurde bestellt oder berechnet … Du kannst es mit demselben Button noch einmal versuchen.“ |
| grüner Schein + „Paid …“ | **Nur auf der Ergebnisseite und nur bei bestätigtem Server-Zustand** (`billing-status`, vom Stripe-Webhook geschrieben): die Karte leuchtet **einmal** in der Erfolgsfarbe (`tone="confirmed"`, `--color-win`) – bei „in Bearbeitung“ nur der ruhige neutrale Halo, bei „Bestätigung nötig“ / „fehlgeschlagen“ / „abgebrochen“ **kein** Grün. Ein Klick, ein Timer oder die Rückkehr-URL lösen den Erfolgs-Glanz nie aus. |
| Karte oben / Formular daneben | **Zwei Spalten ab `md`** (Karte links, Zusammenfassung rechts, `size="lg"`), **auf dem Handy die Karte oben, die Zusammenfassung darunter** (volle Breite). |

**(b) Stripe Payment Element einbetten – geprüft, nicht gebaut (BLOCKED, Betreiberentscheidung):** die vorhandene Architektur ist **gehostetes Checkout per Weiterleitung** (`postCheckout` → `redirectToStripe(res.url)`; im Repo gibt es weder `@stripe/stripe-js`
noch einen Publishable Key `pk_…` noch eine Checkout-Session im eingebetteten Modus). Ein Einbetten würde (1) `@stripe/stripe-js` als lazy Chunk, (2) `pk_test_…` als öffentliche Variable, (3) eine Session mit `ui_mode: embedded` / ein
`PaymentIntent` auf dem Server, (4) Betreiberfreigabe nötig machen – und wäre ohne Stripe-Zugang **nicht prüfbar** (nur Mock). Die Kartengrafik könnte dann die **Ereignisse** `brand` / `complete` / `empty` des Elements spiegeln, **niemals Kartendaten lesen**.
Das ist in `docs/BETREIBER-AUFGABEN.md` §4 („Paket B“) als offene Entscheidung eingetragen.

## Video 3 – Thinking Orbs (`43325949`) und Video 4 – Voice Ring (`e89d84e9`)

Nicht Teil von B, aber hier verwendet: **Thinking Orbs** → `ThinkingOrb` ist schon gebaut (R11); Paket B nutzt `variant="plan"` („wartet auf Dritte“) in der Stage, im Kaufknopf die sechs Punkte `pay-orbs`. **Voice Ring**: nur die Idee „weicher, leuchtender
Ring ohne Zahl und ohne Fortschrittsbalken“ → der Halo der Plan-Karte (Opazität/Skalierung, 3 Atemzüge); die Farbverläufe der Vorlage (Violett/Blau/Orange) passen nicht zu unserer einen Akzentfarbe und bleiben weg. Falls Paket C eine eigene Voice-Ring-Variante liefert,
ist `PayStage` der einzige Ort, an dem sie den Ring ersetzen würde.

## Was bewusst nicht gebaut wurde (wörtlich)

* Keine Kartenfelder, keine Kartenvorschau mit Eingabe, kein Kartentyp-Erkennen, keine Prüfziffer – Stripe-Checkout übernimmt, wir sehen keine Kartendaten.
* Kein „Angemeldet bleiben“-Haken (ohne Funktion), kein Namensfeld, keine Fremdmarke.
* Keine grüne „Bezahlt“-Meldung vor der Serverbestätigung.
* Kein zweites Bewegungssystem neben dem Feldgleiten: das Band kommt *dazu*, es ersetzt `AuthMorph` nicht.
* Kein eingebettetes Payment Element (siehe oben).

## Einbaumatrix (Kurzfassung, vollständig in `docs/KOMPONENTEN-QUELLEN.md`)

| Komponente | Datei | Zustand |
|---|---|---|
| Blatt-Klinge + Markenstreifen | `src/cloud/ui/AuthBlade.tsx`, `AuthSheet.tsx` | neu |
| Bestellkontext in der Anmeldung („Ohne Kauf weiter“) | `src/cloud/ui/OrderContext.tsx` | neu |
| Rückführung über neuen Tab (Bestätigungs-Mail) | `src/store/returnTo.ts` (`order:` auch in `localStorage`, 60 min) | erweitert |
| Keine Konto-Abfrage; Mail-Schritt mit Wiedersenden + Ratenlimit-Hinweis | `src/cloud/client.ts` (`signUp`), `AuthSheet.tsx` (`SentView`) | geändert |
| Einrichtungs-Assistent (4 Schritte) | `src/onboarding/wizard/*` | neu |
| Tarifkarten-CTAs nach Zustand | `src/billing/ctas.ts`, `src/views/preise/PlanGrid.tsx`, `PricingHero.tsx` | neu |
| Jahresbetrag auf den Karten, Team-Summe | `PlanGrid.tsx` (`PriceBlock`), `PricingHero.tsx` | geändert |
| Plan-Karte, Stage, Ablaufband, Summe am Knopf | `src/billing/purchase/PlanCardArt.tsx`, `PayStage.tsx`, `OrderSheet.tsx`, `PayButton.tsx` | neu / umgebaut |
| Erfolgs-Glanz nur bei Serverbestätigung | `src/views/preise/ResultView.tsx` | erweitert |

## Nachtrag Release-Audit: AUTH-03, AUTH-06, VIS-05/06/07

| Befund | Was jetzt gilt | Wo | Beleg |
|---|---|---|---|
| AUTH-03 Konto-Abfrage | `signUp` antwortet für eine **neue** und eine **schon registrierte** Adresse gleich (`{ ok: true, value: { confirm: true } }`) – egal ob Supabase einen verschleierten Nutzer ohne `identities` oder den Fehler `user_already_exists` / `email_exists` liefert. Kein Text der Fehlertabelle sagt „gibt es / gibt es nicht“. Der Satz im Mail-Schritt: „Wenn die Adresse frei ist, schicken wir dir eine Bestätigung … Hast du schon ein Konto, melde dich an oder setze dein Passwort zurück.“ – mit dem Weg „Passwort vergessen?“ im selben Schritt. Zurücksetzen und Magic Link antworten ohnehin für jede Adresse gleich. | `src/cloud/client.ts`, `src/cloud/authErrors.ts` (`AUTH_NEUTRAL`), `src/cloud/ui/AuthSheet.tsx` (`SentView`) | `tests/unit/cloud.signup.neutral.test.ts` (alle Codes der Tabelle geprüft), `tests/unit/cloud.authB.test.tsx`, `tests/e2e/auth-b.spec.ts` |
| AUTH-06 Vorauswahl nur im Tab | Plan, Intervall und Sitze (nie ein Preis) hängen als `?order=premium.year.1` am Link der Mail (`emailRedirectTo` / `redirectTo` für Registrierung, Wiedersenden, Magic Link, Passwort zurücksetzen). Beim Öffnen wird der Wert **erneut** gegen die Whitelist geprüft (Plan ∈ pro/premium/team, Intervall ∈ month/year, Sitze ein- oder zweistellig und dann geklemmt: Team 2–50, die anderen Tarife genau 1; ≤ 60 Zeichen), der Parameter verlässt die Adresse sofort, übrig bleibt **eine Notiz**, die nach der Anmeldung die **Bestellübersicht** öffnet – **bestellt wird nichts**. Zusätzlich liegt die Notiz 60 Minuten in `localStorage` (Weg über einen neuen Tab). Der Server prüft Plan, Intervall und Sitze beim Bestellen noch einmal (Team 2–50) und nimmt nie einen Preis aus dem Browser. | `src/store/returnTo.ts` (`captureOrderQuery`, `pendingOrderParam`), `src/cloud/client.ts` (`redirectUrl`), `src/billing/ui/BillingHost.tsx` | `tests/unit/cloud.signup.neutral.test.ts`, `tests/unit/store.returnTo.order.test.ts`, `tests/unit/purchase.functions.test.ts` („a preselection that came with a link is only a SUGGESTION“), `tests/e2e/auth-b.spec.ts` |
| AUTH-06 Betreiber | Die Redirect-Liste muss `https://<site>/**` enthalten, sonst fällt Supabase auf die Site URL zurück (die Auswahl bleibt dann nur als Notiz im selben Browser). Gegen ein echtes Supabase-Projekt **nicht geprüft** → Betreiberaufgabe. | `SETUP.md` §2.2, `docs/BETREIBER-AUFGABEN.md` §2 | – |
| VIS-05/06/07 Bestellsumme | Mit Probezeit sagt die Bestellung ehrlich: „Heute 0 € (14 Tage kostenlos testen), danach 120 € pro Jahr – die erste Zahlung ist am …“; am Knopf und auf der Bühne: „Heute 0 €, danach … pro Jahr“. Team: 2 Sitze × 190 € = **380 € pro Jahr** (Mindestzahl 2; Standard jetzt 2 statt 3). Die fest vorgeschriebene Beschriftung „Zahlungspflichtig bestellen“ bleibt unverändert. | `src/billing/purchase/strings.ts` (`ORDER.trial`, `ORDER.due`), `OrderSheet.tsx`, `PayStage.tsx` | `tests/unit/billing.purchase.stage.test.tsx` („VIS-05/06/07“), `tests/e2e/kaufstrecke.spec.ts`, `tests/e2e/auth-b.spec.ts` (Team 380 €) |

## Bilder (Stand nach der Umsetzung, `docs/audit/img-b/*-desktop.jpg` und `*-mobile.jpg`, je ≤ 125 KB)

Aufgenommen gegen die **Mocks** (Cloud-Build, Supabase- und Stripe-Mock) – sie zeigen die Oberfläche, nicht ein echtes Konto, keine echte Zahlung.
`auth-signin`, `auth-signup` (Markenstreifen, ein Satz je Schritt, Hilfetext am Passwort, Zustimmung), `auth-sent` (neutraler Mail-Schritt, Warten vor „Erneut senden“, Limit-Hinweis, „Passwort vergessen?“), `auth-order-context` (gewählte Bestellung in der Registrierung, „Ohne Kauf weiter“),
`preise-abgemeldet` (Betrag, der fällig wird), `order-front` / `order-back` (Planbild vorn und Rückseite „Das ist enthalten“), `order-team-trial` (Team, 2 Sitze, Link `?order=team.year.1`: „Heute 0 € (14 Tage kostenlos testen), danach 380 € pro Jahr“, Fuß „Heute 0 €, danach 380 € pro Jahr“), `pay-stage` (Übergabe: „Wir bereiten deine Zahlung bei Stripe vor …“, Knopf „Wird vorbereitet …“ in derselben Zelle), `wizard-1-konto`, `wizard-2-daten`.
**Nicht als Standbild belegt:** das Band mitten im Wechsel (ein Standbild trifft die 560 ms auf einer ausgelasteten Maschine nicht verlässlich – belegt durch `tests/unit/cloud.authB.test.tsx` und `tests/e2e/auth-b.spec.ts`: Band vorhanden, Wechsel erst hinter dem Band, kein Band bei Reduced Motion) und die Ergebnisseite „Dein Abo ist aktiv“ (der Mock liefert dort einen Betrag von 24 € statt 240 €; die Seite zeigt den Betrag des Servers – das ist ein Mock-Wert, kein Fehler der Seite, die Prüfung steht in `tests/unit/billing.purchase.stage.test.tsx`).

## Beleg und Grenzen

* Alles wird gegen die **vorhandenen Mocks** getestet (`tests/e2e/mocks/supabase.ts`, `billing.ts`). Das beweist den **Browser-Ablauf**, nicht ein echtes Stripe-Konto, nicht den Versand einer echten E-Mail und nicht die Zustellung
  eines echten Webhooks → **nur Mock**. Was der Betreiber für echte Sandbox-Zahlungen liefern muss, steht in `docs/BETREIBER-AUFGABEN.md` §4 („Paket B“).
* Nichts hier ändert die serverseitige Wahrheit der Freischaltung: der Tarif kommt aus `profiles.plan` (nur der Stripe-Webhook schreibt dort), die Ergebnisseite fragt `billing-status` und behauptet „aktiv“ erst bei bestätigtem Server-Zustand.
* Rechtstexte bleiben „Entwurf – Prüfung durch Anwalt nötig“; die Beschriftung der abschließenden Bestellaktion hat Vorrang vor jeder Animation.
* CSS: alle neuen Stile liegen in `src/billing/purchase/purchase.css` (Lazy-Chunk der Kaufstrecke) oder als `style`-Objekte der neuen Komponenten; die globale Datei wächst nur um die wenigen neuen Utility-Klassen (Messwerte im Bericht).
* **Beim Messen gefundener und behobener Fehler (Höhe der Anmelde-Karte):** Die vorhandene Prüfung `interaktionen.spec.ts` („Anmelden ↔ Registrieren … die Höhe federt statt zu springen“) wurde mit dem Band **flackrig** (3 von 12, dann 6 von 16 Läufen; die Maschine hatte Last 20+ auf 4 Kernen, einzelne Bilder dauerten 0,2–0,8 s). Die Messung (Bild für Bild: Höhe des Blattes, Transform, Höhe der Federbox) zeigte eine Ursache, die schon vor dem Band angelegt war und erst unter einem hängenden Bild sichtbar wird: `MorphHeight` hielt die **Innenhöhe** des Inhalts fest, nicht die Höhe der Box mit ihrem Innenabstand – 8 px zu wenig, das Blatt lief bei **jedem** Wechsel eine eigene kleine Größenanimation (FLIP, Skalierung 1,012) neben der Feder der Karte, und ein Bild, das hängt, lässt beide Zeitfedern auseinanderlaufen (Überschwinger bis +10 px). Dazu eine Vorsorge: der Markenstreifen stand **außerhalb** der Box, eine geänderte Zeilenzahl seines Satzes hätte das Blatt ungehalten erreicht. Jetzt: die Box hält ihre Border-Box-Höhe (Innenabstand eingerechnet) und der Streifen ist ihr `lead` (`AuthMorph`-Eigenschaft). Gemessen danach: Blatt-Transform während des Wechsels `none` (mobil, 4 von 4), Überschwinger 0, Rücksprünge 0. Übrig bleibt ein seltener Fehlschlag, wenn ein Bild **> 0,5 s** hängt und die Feder in dieser Lücke fertig wird („mindestens ein Zwischenbild“ fehlt; 1 von 16 Läufen) – das ist die Last der Maschine, nicht die Bewegung.
