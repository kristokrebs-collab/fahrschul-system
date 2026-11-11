# Verhaltenspsychologie im Produkt: was wir bauen, was nicht (Paket P)

Stand: 08.11.2026. **Haltung: Anti-Gamification. Wir drängen dich nie zum Handeln.** Das Journal soll Disziplin, Klarheit und echten Nutzen
fördern. Es belohnt **Prozess** (Rückblick, Checkliste, Backup, geprüfte Verbindung, fertige Einrichtung) und nie ein Ergebnis (Gewinn, Verlust,
Ausführung eines Trades). Das ist eine Produktentscheidung, keine Garantie für ein Verhalten oder einen Erfolg.

**Quelle.** Grundlage ist die Analyse „Nutzerbindung und Dopamin-Mechanismen“, die der Betreiber im Chat geliefert hat (sieben Engagement-Regeln,
Hook-Modell, Octalysis, Machine Zone, Near-Miss, „Losses disguised as Wins“, Robinhood-Gamification, Temu-Mechaniken, Dark Patterns). Der
Originaltext liegt nur im Chat. **Alle Wirksamkeitsbehauptungen dieser Quelle stehen hier ausschließlich als „laut Quelle“** – wir haben sie nicht
geprüft und stellen sie nicht als eigene Tatsachen dar.

**Recht.** Die Rechtsbezüge unten sind **Hinweise für die Prüfung durch eine Anwältin oder einen Anwalt, keine Rechtsaussage** (siehe
[RECHT-CHECKLISTE](RECHT-CHECKLISTE.md)). Nichts hier ist „rechtssicher“ oder „abmahnsicher“.

## 1. Die sieben Regeln der Quelle → was daraus wurde

| # | Regel (laut Quelle) | Umgesetzt (Datei · Beleg) | Bewusst nicht |
|---|---|---|---|
| 1 | Den Faden halten / offene Schleifen (Zeigarnik): laut Quelle bleibt Unfertiges im Kopf | Echter Fortschritt der Einrichtung: „2 von 4 Schritten durchgegangen“ und **„Weiter, wo du aufgehört hast“** in Einstellungen › Einführung & Hilfe und als ruhige Zeile auf der Konto-Seite, nur solange die Einrichtung begonnen und pausiert ist (`src/onboarding/wizard/wizardStore.ts` `wizardProgress`, `WizardResumeNote.tsx`, `OnboardingCard.tsx` · `tests/unit/psych.reminder.test.ts`, `tests/e2e/psychologie.spec.ts`). Offener Wochenrückblick: die Karte „Wochenabschluss“ in Berichte sagt sachlich „noch offen“ (`WeekCloseCard.tsx`). | Kein Druck („nur noch 1 Schritt!“), keine Frist, nichts auf Übersicht oder Cockpit (beide unverändert). Ein Fortschritt wird nie aufgefüllt: „3 von 4“ heißt, drei Schritte liegen hinter dir. |
| 2 | Bewusst zurückholen (Hook: Trigger) | **Optionale** Erinnerung an den Wochenrückblick: Standard **aus**, nur in der App, höchstens einmal pro Woche, Ruhezeiten (Standard 22–08 Uhr), Wortlaut „Dein Rückblick für KW 45 ist bereit“ (`src/views/berichte/reviewReminder.ts`, `ReviewReminderHost.tsx`, Schalter in `WeekCloseCard.tsx` · `tests/unit/psych.reminder.test.ts`, `tests/e2e/psychologie.spec.ts`). Alarme bleiben, was der Nutzer selbst eingestellt hat. | Keine Pushes über Kursbewegungen, keine FOMO-Texte, keine Erinnerung ohne Einschalten, kein Push und keine Mail (siehe „Offen“). Laut Quelle hat Robinhood Pushes bei Kursbewegungen eingesetzt und damit die Handelsintensität um 25 % erhöht – genau das wollen wir nicht. |
| 3 | Eine Oberfläche, die sich zu öffnen lohnt (Ästhetik, Neugier) | Unverändert: die dunkle Nothing-Optik, Punktschrift, zurückhaltender roter Akzent. Neugier kommt aus den **eigenen Daten** (Coach-Muster, Wochenreview), nicht aus Zufall. | Keine Zufallsbelohnung, kein Glücksrad (laut Quelle Temu-Mechanik). |
| 4 | Selbst machen (IKEA-Effekt) | Im Assistenten, Schritt „Daten“: eine **eigene Regel** aufschreiben, sichtbar „Deine Regeln: n“ und „n davon sind von dir“ (`SetupWizard.tsx` `OwnRules` · `tests/e2e/psychologie.spec.ts`). Im Wochenabschluss: **eine eigene Lektion für morgen** (≤ 200 Zeichen, wird mit der Woche gespeichert). Export und Backup bleiben jederzeit leicht (Einstellungen › Daten). | Kein Lock-in als Druckmittel; Eigenes lässt sich exportieren, ändern, löschen. |
| 5 | Auf zwei Sinneskanälen belohnen | `src/motion/processFeedback.ts` `processDone(...)`: eine ruhige Toast-Insel mit kleinem Puff (sichtbar) plus **optional** kurze Vibration und leiser Ton (beides **aus**; Einstellungen › Darstellung › Bewegung › „Rückmeldung bei geschafften Schritten“). **Nur** bei: Wochenrückblick abgeschlossen, Checkliste vollständig, Tag abgeschlossen (nur wenn Checkliste und Review des Tages erledigt sind, Paket F2), Backup erstellt, Verbindung geprüft, Einrichtung fertig. Unter „Bewegung reduzieren“ keine Punkte und keine Vibration. | **Nie** bei Gewinn, Trade-Ausführung oder Verlust. „Trade eintragen“ (Formular, Animation, Ablauf) ist in diesem Paket nicht angefasst – nichts dort ergänzt. |
| 6 | Rahmen setzen (Framing, Prospect Theory) | Netto nach Gebühren und Funding ist die Hauptzahl (Berichte: „Ergebnis nach Kosten“ zuerst, Netto groß in `ReportHero`). Verluste neutral: mit Vorzeichen und Beschriftung, gleiche Gestaltung wie Gewinne, keine festliche Grafik. Wächter-Test gegen „Losses disguised as Wins“ (siehe 3). Die Flip-Grafik (Top-Trader-Karte) bleibt sachlich: „keine Prognose“. | Kein „Fast gewonnen“, keine Beinahe-Treffer-Inszenierung (Near-Miss), keine Fanfare bei Teilverlust. |
| 7 | Die Bitte in den Höhepunkt legen (Peak-End) | **Umgekehrt**: der Wochenabschluss endet auf **Verhalten** („Verhalten dieser Woche“, eine Lektion für morgen), nicht auf dem Ergebnis, und **nie** mit einer Kauf- oder Upgrade-Frage. Hinweise auf einen höheren Tarif stehen nur an neutralen Stellen (Konto, Tarife) und nur, wenn jemand an eine echte Grenze stößt: „Limit erreicht · Dieses Limit gehört zu Pro.“; das Bestellfenster hat ein gleichwertiges **„Nein danke“** (`src/billing/strings.ts`, `LimitMeter.tsx`, `UpgradeSheet.tsx`). | Keine Kaufabfrage im Moment eines Gewinns, kein Confirmshaming („Nein, ich will nicht erfolgreich sein“), keine erschwerte Kündigung (Kündigung zuerst, Begründung danach: § 312k BGB, schon vorhanden). |

## 2. Hook-Modell und Octalysis

| Baustein (laut Quelle) | Entscheidung |
|---|---|
| Trigger (extern/intern) | extern: nur die optionale Rückblick-Erinnerung (aus, in der App). Intern: kommt aus dem eigenen Journal, wird nicht erzeugt. |
| Action | Eine Handlung, die dem Trader nützt: Rückblick schließen, Checkliste abhaken. Keine Handlung, die Handeln fördert. |
| Variable Belohnung | **nicht gebaut.** Erkenntnisse aus den eigenen Daten (Coach, Wochenreview) sind informativ und nicht zufällig dosiert. |
| Investment | Eigene Regeln, Lektionen, Ziele, Konten benennen: ja, mit Export. Kein Aufbau von Wechselkosten als Druck. |
| Octalysis White-Hat (Sinn, Entwicklung, Kreativität, Besitz) | Ziel dieses Pakets: Sinn („Disziplin“), Entwicklung (echter Fortschritt), Kreativität/Eigenleistung (eigene Regel, eigene Lektion). |
| Octalysis Black-Hat (Knappheit, Verlustangst, Unvorhersehbarkeit) | **nicht gebaut:** keine Verknappung, kein Countdown, keine Verlustangst, keine Zufallsbelohnung. |

## 3. Was bewusst NICHT gebaut wird (mit Grund)

| Nicht gebaut | Grund |
|---|---|
| Konfetti, Fanfare, Dopamin-Feedback bei Gewinn oder Trade-Ausführung | Schaden für Retail-Trader (Übertrading, laut Quelle Machine Zone); das Produktversprechen ist Disziplin. Laut Quelle hat die Aufsicht bei Robinhood auf Konfetti-Gamification reagiert (SEC/FINRA) – das ist unsere Quelle, nicht unsere Prüfung. |
| Als Gewinn getarnte Verluste (LDW), Near-Miss-Inszenierung | irreführend; Wächter-Test (`tests/unit/psych.guard.test.ts`, Block 3). |
| FOMO, Verknappung, Countdown, erfundener Social Proof im Kauf-/Tarifpfad | Hinweis für die Prüfung: UWG, DSA Art. 25 (Dark Patterns), Omnibus-Richtlinie, § 312j / § 312k BGB. Wächter-Test über die Dateien des Kaufpfads (Block 4). Das Schild „Beliebt“ auf der Tarifkarte heißt jetzt „Empfohlen“, weil niemand eine Beliebtheit gemessen hat. |
| Streaks mit Verlustangst-Strafe, „Streak in Gefahr“-Push | Serien belohnen nur Verhalten, nie Volumen oder Gewinn (`src/domain/growth/streaks.ts`, Test `tests/unit/growth.tracking.test.ts`); „heute offen“ ist neutral, Tage ohne Trades und Wochenenden brechen eine Serie nicht (der „Pause-Tag“ ist kostenlos). Die Seite Wachstum enthält kein „in Gefahr“ (`tests/e2e/psychologie.spec.ts`). |
| Zufallsbelohnungen (Glücksrad) | laut Quelle eine Temu-Mechanik; Glücksspiel-Nähe. |
| Kauf-/Upgrade-Abfrage im Höhepunkt eines Gewinns | Peak-End-Missbrauch; siehe Regel 7. |
| Confirmshaming, Roach-Motel (erschwerte Kündigung) | Dark Patterns; Kündigung ist schon ein eigener Schritt ohne Hürde davor. |
| Push bei Kleinstkursbewegungen | siehe Regel 2. |
| Konfetti bei Import, Börsen-Abgleich, Ausbruch auf ein neues Hoch | in diesem Paket entfernt (`CsvImportSheet.tsx`, `ExchangeConnectionsCard.tsx`, `BoxStateCard.tsx`): ein Import ist kein Erfolg des Traders, und ein Marktpreis ist keine Leistung. Eine geprüfte Verbindung bekommt stattdessen die ruhige Bestätigung. |

## 4. Schutz-Reibung als Funktion, nicht als Bevormundung

- **Eigenes Limit.** Wird ein Limit erreicht, sagt die Risiko-Seite ruhig: „Du hast dein eigenes Limit erreicht – so hast du es dir gesetzt. Nichts wird blockiert.“ Das gilt nur, wenn der Nutzer Limits selbst gesetzt hat (`limitsSetByUser`: `settings.discipline` / `settings.risk` stehen nur nach einer Änderung dort). Bei den Standardgrenzen heißt es „Die Standardgrenze ist erreicht …“ (`LimitsCard.tsx`).
- **Abkühlzeit ist opt-in.** `cooldownMin` steht jetzt auf **0 = keine Pause**; vorher war eine Pause von 30 Minuten nach zwei Verlusten und bis Mitternacht nach einem überschrittenen Tageslimit **voreingestellt**. Wer die Pause will, stellt „Pausenlänge“ unter Risiko › Einstellungen ein (`src/domain/risk/config.ts`, `limits.ts` `cooldownOf`). Die Grenzringe und die Warn-Toasts bleiben; „Limit überschreiben“ gibt es, solange eine Pause läuft. **Das ändert ein Verhalten für alle, die nie eine Pause eingestellt hatten** – Entscheidung des Betreibers bitte bestätigen.
- Nichts wird jemals blockiert.

## 5. Wächter und Tests

| Wächter | Datei |
|---|---|
| Rückmeldung nur bei Prozess-Ereignissen: feste Liste von sechs Ereignissen (Paket F2: `dayClose`), feste Aufrufstellen, nie in Editor / Store / Domain / Übersicht; unbekannte Ereignisse werden verworfen; Ton und Vibration nur nach dem Einschalten | `tests/unit/psych.guard.test.ts` (Blöcke 1 und „process feedback itself“) |
| Konfetti nur von bekannten Stellen (Liste mit Begründung), die entfernten Stellen bleiben ohne; das Toast-Flag `milestone` setzt nur die Prozess-Rückmeldung | dasselbe, Block 2 |
| LDW: kein Burst bei Verlust, flach, offen oder unbekannt; keine Fanfare-/Konfetti-/Near-Miss-Wörter in den Texten des Produkts; Verluste mit Vorzeichen und gleichem Markup | dasselbe, Block 3 |
| Keine Druckwörter im Kauf-/Tarifpfad („nur noch“, „letzte Chance“, Countdown, Verknappung, erfundene Beliebtheit …); „Nein danke“ und „Empfohlen“ | dasselbe, Block 4 (22 Dateien) |
| Alles Optionale ist standardmäßig aus: Töne/Vibration, Erinnerung, Pause | dasselbe, Block 5 |
| Erinnerung: aus, zu früh, Ruhezeit (auch über Mitternacht), einmal pro Woche, abgeschlossen, leere Woche; Montag meint die vergangene Woche | `tests/unit/psych.reminder.test.ts` |
| Wochenabschluss in den Einstellungen (nur Wochenschlüssel, nie gelöscht, auf 200 Zeichen gekürzt) und echter Wizard-Fortschritt | dasselbe |
| E2E (mobil + Desktop): Wochenabschluss, Erinnerung (Standard aus, genau ein Hinweis, Ruhezeit, nicht ohne Einschalten), Einrichtung (Fortschritt, eigene Regel, Fertig), Rückmeldung (aus, reduzierte Bewegung ohne Punkte), Wachstum ohne „in Gefahr“, axe auf den neuen Karten | `tests/e2e/psychologie.spec.ts` |
| Pause nur auf Wunsch, Hinweis „eigenes Limit“ vs. „Standardgrenze“ | `tests/unit/views.risiko.test.tsx`, `tests/unit/risk.limits.test.ts` |
| Frost (Paket F2), siehe Abschnitt 8: „Heute abschließen“ belohnt nur erledigten Prozess (genau ein `processDone("dayClose")`, nur im `earned`-Zweig; Gewinn, Verlust, Trade-Zahl, Order kommen im Code der Entscheidung nicht vor); die Wochenpunkte lesen dasselbe Tagesprädikat wie die Serien und nie das Abschluss-Flag; die Journal-Karte färbt ein Verlust-Ergebnis rot wie jeden anderen Eintrag; die Fragenleiste ruft kein Netz und kein Modell | `tests/unit/psych.guard.test.ts` Block 6, `tests/unit/frost.domain.test.ts`, `tests/unit/views.frost.test.tsx`, `tests/e2e/frost-f2.spec.ts` |

## 6. Geprüft und unverändert gelassen, aber offen für eine Entscheidung

1. **Gewinn-Konfetti beim Speichern eines Trades: entfernt (Entscheidung des Betreibers, 10.11.2026: „kein Konfetti“).** Bis dahin ließen `src/overlays/TradeEditor.tsx` und `src/overlays/celebration.ts` bei einem realisierten Gewinn Punkte aufsteigen; das widersprach der Regel „nie bei Gewinn“. Das Modul ist gelöscht, der Editor startet keinen Burst mehr; das Ergebnis sagt weiterhin der Toast (Vorzeichen und Ton). Der Wächter-Test führt `TradeEditor.tsx` jetzt in der Liste der Stellen, die ohne Burst bleiben (`tests/unit/psych.guard.test.ts`, Block 2 und 3; `tests/unit/overlays.motion.test.tsx`).
2. **„Bericht bereit“: endet jetzt auf dem Verhalten (Runde 14).** `ReportReadyHost` ist der Vollbild-Hinweis beim Wochen-/Monatsende mit Netto, Trades und Win-Rate. Er endete auf dem Ergebnis; jetzt ist die letzte Zeile vor den Knöpfen „Verhalten: Nach Plan gehandelt: 6 von 7 Trades mit Angabe.“ (`planLine` in `src/domain/reports/archive.ts`): gezählt aus den Trades, die sagen, ob der Plan befolgt wurde, ohne Urteil und ohne Lob für ein Ergebnis; steht bei keinem Trade eine Angabe, sagt die Zeile genau das („Bei keinem Trade steht, ob er nach Plan lief.“) statt einer Quote, die niemand gemessen hat. Beleg: `tests/unit/reports.domain.test.ts`, `tests/unit/views.berichte.test.tsx`. Weiter offen für eine Entscheidung: ob der Hinweis abschaltbar sein soll (er erscheint einmal je Zeitraum und Gerät).
3. **Serien-Konfetti** in Wachstum und Berichten (`celebrateStreak`, `celebrateRecord` für Prozess-Serien und -Ziele) bleibt, weil es nur Prozess belohnt (Ergebnisziele feiern nie, `celebrate: false`); ob es leiser werden soll, ist Geschmackssache.

## 7. Offen / nicht Teil dieses Pakets

- **Erinnerung nur in der App.** Eine Erinnerung per E-Mail oder Web-Push braucht den Server (Cron, Versand) und eine Einwilligung; sie ist nicht gebaut und wird nicht versprochen.
- **Pause nach Verlusten** ist neu „aus“ (siehe 4): Bestätigung erbeten.
- **Rechtstexte.** Die Rechtsbezüge in 3 sind Hinweise; die Prüfung steht aus ([RECHT-CHECKLISTE](RECHT-CHECKLISTE.md)).
- **Wirksamkeit.** Ob die ruhige Rückmeldung oder die Erinnerung Disziplin tatsächlich fördert, ist **nicht gemessen**; es gibt keine Nutzerzahlen.

## 8. Frost-Elemente (Paket F2): was dazukam, was es belohnt, was nicht

Drei Karten in Berichte (nie Übersicht, Cockpit oder „Trade eintragen“), im Milchglas-Look (`src/views/berichte/frost.css`, eigener Lazy-CSS-Chunk, die Erstladungs-CSS wuchs nicht). Alle mit echter Funktion und echten Daten – keine
simulierten Zahlen. Die Gestaltungsidee stammt aus dem Prototyp der Schwester-Sitzung (Konzept und Optik; unser Code, unsere Schrift und Tokens).

| Element | Was es tut | Belohnt / zeigt | Bewusst nicht |
|---|---|---|---|
| **Einträge durchgehen** (`JournalCard.tsx`, `domain/reports/entries.ts`) | „Eintrag 06 von 12“ aus der echten Liste der abgeschlossenen Trades des Berichtszeitraums; Setup- und Tag-Chips, Plan, R und Netto aus dem Trade, Review-Stand; Blättern per Knopf, Taste, Wischen | nichts – es ist Ansicht, keine Belohnung | Ein Verlust bleibt rot, gleiche Gestaltung wie ein Gewinn; ein Trade ohne Stopp hat kein R und sagt das; kein „fast“, keine Fanfare, kein Zufall |
| **Heute abschließen** (`DayCloseCard.tsx`, `CloseRitual.tsx`, `domain/growth/dayClose.ts`) | der **eine** Abschluss-Ritus für Tag und Woche (derselbe Baustein im Wochenabschluss): Checkliste, Review, Notiz des Tages als nüchterne Liste, runder Haken-Knopf, die Woche als sieben stille Punkte | `processDone("dayClose")` **nur**, wenn Checkliste und Review des Tages beim Abschließen erledigt sind (an einem Tag ohne Trades zählt Notiz oder Check-in); sonst wird ruhig vermerkt „Noch offen: Review.“, ohne Punkte, Vibration oder Ton | kein Gewinn, kein Verlust, keine Trade-Zahl, keine Order als Grund (Tests mit +9.999 und −9.999 und 1 gegen 5 Trades); die Punkte der Woche („4 von 7 Tagen mit Rückblick“) zählen den Prozess über dasselbe Tagesprädikat wie die Serien (`journalDayOk`), ein Tag ohne Trades und Text ist neutral, kein „verpasst“, keine Serie, die reißt; ein Klick allein macht keinen Punkt |
| **Frag dein Journal** (`AskJournalCard.tsx`, `domain/ask`, `coach/nlq/audit.ts`) | Punkt → Leiste → Schimmer → drei Ergebniskarten; lokale, deterministische Auswertung, Fragetypen in `docs/FRAG-DEIN-JOURNAL.md` | nichts – Auskunft | kein Netz, kein Sprachmodell, kein Raten; „So kann ich das noch nicht beantworten.“ mit drei Beispielen; keine Prognose, keine Empfehlung |

- **Vibration und Ton** sind dieselbe Einstellung wie Einstellungen › Darstellung › Bewegung (`useFeedbackPref`), **standardmäßig aus**; die zwei Schalter im Ritus schreiben sie. Unter „Bewegung reduzieren“ keine Vibration und kein Punktefeuer
  (Test `tests/e2e/frost-f2.spec.ts`, „Reduzierte Bewegung“). Der Ton ist keine Bewegung und folgt nur seinem Schalter.
- **Tagesabschluss gespeichert** in `settings.coach.dayCloses` (synchron, nie gelöscht – „Wieder öffnen“ setzt `closed: false`), zusammen mit `ready`, dem Stand des Prozesses im Augenblick des Abschließens.
- **Wo die Karte steht:** im Bericht des laufenden Tages oder der laufenden Woche (Art „Tag“ / „Woche“, dann „Laufend“, Fokus „Alles“). Ein eigener Einstieg auf der Startseite ist **nicht** gebaut (Startseite unverändert).
- **Offen / nicht belegt:** ob der Ritus Disziplin tatsächlich fördert, ist **nicht gemessen** (keine Nutzerzahlen); auf echten Geräten wurden Vibration und Ton nicht gehört, nur gegen nachgebaute Schnittstellen geprüft.
