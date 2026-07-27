# Bekannte Grenzen

Ohne Beschönigung. Wenn etwas hier steht, funktioniert es nicht oder nur
eingeschränkt — auch wenn die Oberfläche es nahelegt.

---

## 1. Es ist noch nie etwas öffentlich veröffentlicht worden

Der komplette Weg wurde gegen das **kontrollierte Testziel** (Sandbox)
nachgewiesen: Freigabe → Warteschlange → Zustellung → Zustellprüfung →
Kennzahlen → Bewertung → Lernbericht.

Die Adapter für Instagram, Facebook, TikTok und YouTube sind **echter Code
gegen die offiziellen APIs** — kein Platzhalter, keine Attrappe. Sie wurden
aber **nie gegen ein echtes Konto ausgeführt**, weil in dieser Umgebung keine
Zugangsdaten vorliegen.

Was daraus folgt: Die erste echte Veröffentlichung ist ein Test. Führen Sie sie
mit einem harmlosen Beitrag durch und sehen Sie im Anschluss selbst auf der
Plattform nach.

Nachweislich funktioniert bereits das Fehlverhalten: fehlende Zugangsdaten
führen zu einem sichtbaren Fehler in der Dead-Letter-Queue mit Klartext-Ursache
und Alarm, nicht zu einem stillen Überspringen (`publishing.test.ts`).

## 2. Die generativen Agenten laufen ohne LLM-Zugangsdaten eingeschränkt

Ohne `ANTHROPIC_API_KEY` arbeiten Strategie, Recherche und Produktion in einem
**deterministischen Kompositionsmodus**: Texte werden aus Säulen, Zielgruppen,
Einwänden und belegten Fakten zusammengesetzt.

Das Ergebnis ist korrekt, belegt und markenspezifisch — aber es ist keine
freie Formulierung. Die Hooks sind vorhersehbar, die Variation gering.

Der Zustand steht offen in *Heute*, in *System* und unter `/api/health/detail`.
Er wird nicht als vollwertige Generierung ausgegeben.

Die **prüfenden** Agenten sind davon nicht betroffen — sie sind Regelwerke und
laufen unverändert.

## 3. Die Archivsuche ist lexikalisch und regelbasiert, nicht semantisch

`searchMediaNatural` versteht Suchbegriffe, Ausschlüsse („ohne Schüler"),
Zeitfenster („nicht in den letzten 60 Tagen benutzt"), Medientyp und
Ausrichtung. Jeder Treffer trägt eine Begründung.

Was sie **nicht** kann: Bedeutungsähnlichkeit. „Nutzfahrzeug" findet keinen
Treffer, der nur mit „LKW" verschlagwortet ist. Es ist kein Embedding-Modell
angebunden, und die Oberfläche behauptet auch nicht, es gäbe eines.

**Folge im Alltag:** Wenn die Themensuche nichts Passendes findet, greift die
Kuration in zwei Stufen auf breiteres und schließlich auf das beste verfügbare
freigegebene Material zurück — und **sagt das im Produktionsprotokoll**
(„Kein thematisch passendes Material gefunden … Der Bezug zwischen Bild und
Aussage ist dadurch schwach"). Der Rechtefilter wird dabei nie gelockert. Sie
sollten diesen Hinweis vor der Freigabe ernst nehmen.

Ansatzpunkt für eine Erweiterung: `rankResults()` in `src/domain/media.ts`.

## 4. Bild- und Videoinhalte werden nicht analysiert

Die Datenschutz-Vorprüfung arbeitet auf **Text**: Verschlagwortung,
Beschreibung, Notizen. Sie erkennt keine Gesichter, keine Kennzeichen und
keine Minderjährigen im Bild.

Ein Asset, das mit „Fuhrpark" verschlagwortet ist, aber ein lesbares
Kennzeichen zeigt, wird von der Automatik **nicht** erkannt. Deshalb steht
jedes Asset standardmäßig auf `UNKNOWN` und muss von einem Menschen gesichtet
werden. Die Sichtung ist die eigentliche Prüfung; die Automatik füllt nur die
Warteschlange und begründet, warum etwas darin liegt.

## 5. Antworten werden entworfen, aber nicht gesendet

Der Posteingang klassifiziert Nachrichten, erkennt Anfrageabsicht und erzeugt
Antwortentwürfe im Markenton. Eine freigegebene Antwort wird jedoch **nicht
automatisch versendet** — es ist kein Adapter mit Schreibrecht auf Kommentare
und Direktnachrichten angebunden.

Das ist eine bewusste Entscheidung: ein Adapter, der so tut, als hätte er
gesendet, wäre schlimmer als keiner. Die Oberfläche sagt beim Freigeben
ausdrücklich, dass manuell gesendet werden muss.

Ebenso: eingehende Nachrichten werden **nicht automatisch abgeholt**. Sie
kommen über `POST /api/inbox/ingest` ins System. Die automatische Abholung
über die Meta Graph API ist implementierbar, aber nicht implementiert.

## 6. Kennzahlen sind so gut wie die Plattform sie liefert

- **Instagram:** liefert die meisten Werte. Einzelne Metriken sind je nach
  Medientyp nicht verfügbar; sie werden als *fehlend* geführt, nicht als 0.
- **TikTok:** liefert Aufrufe, Likes, Kommentare, Weiterleitungen. **Keine**
  Speicherungen, keine Profilbesuche, keine Wiedergabedauer.
- **YouTube:** liefert Basiszahlen über die Data API. **Retention und
  Zuschauerbindung fehlen** — dafür wäre die YouTube Analytics API mit eigener
  Autorisierung nötig.
- **Facebook:** eingeschränkter Satz.

Fehlende Werte senken die **Konfidenz** der Bewertung, nicht heimlich den Wert.
Eine Bewertung mit Konfidenz `low` ist ein Anhaltspunkt, kein Ergebnis.

**Umsatz und Anmeldungen muss der Inhaber selbst eintragen.** Ohne diese
Angaben bleibt der Business Impact Score strukturell unvollständig — das
System kann nicht wissen, wer sich angemeldet hat.

## 7. Die Sandbox-Kennzahlen sind keine Leistungsdaten

Sie werden deterministisch aus der Beitrags-ID abgeleitet — gleiche ID, gleiche
Werte, kein Zufall. Sie existieren ausschließlich, damit die Auswertungs- und
Lernstrecke technisch durchlaufen kann.

Jede Ausgabe, die sie verwendet, trägt den Hinweis `SANDBOX_NOTE`. Sie stellen
keinerlei Erfolg dar und dürfen nicht als solcher gelesen werden.

## 8. Organisches Posten liefert keine Kausalität

Das Experimentmodul verweigert einen Sieger, solange die Mindeststichprobe je
Variante nicht erreicht ist, und benennt Störgrößen ungefragt — abweichende
Sendezeiten, Themenüberschneidung, Formatunterschiede, ungleiche
Gruppengrößen, zu langer Testzeitraum. Ist der Vorsprung kleiner als die
Streuung innerhalb der Gruppen, sagt es „nicht von Rauschen zu trennen".

Das macht die Aussagen ehrlicher, nicht kausal. Bei organischer Ausspielung
entscheidet der Algorithmus mit, und dieser Einfluss ist nicht kontrollierbar.
Behandeln Sie Ergebnisse als Hinweise, nie als Beweise.

## 9. Ein Schreibprozess zur Zeit

SQLite mit WAL erlaubt viele Leser, aber nur einen Schreiber. Für einen Betrieb
dieser Größe ist das kein Engpass. Bei mehreren Instanzen hinter einem
Load-Balancer wäre PostgreSQL nötig (Ansatzpunkt: `src/db/index.ts`).

Wenn Sie dennoch mehrere Instanzen betreiben: `ENABLE_WORKERS=true` darf nur
auf **einer** stehen, sonst laufen Zeitplanaufgaben doppelt.

## 10. Kein automatisches Token-Erneuern

Läuft ein Plattform-Token ab, meldet das System das rechtzeitig — ab sieben
Tagen Restlaufzeit als Warnung, ab zwei Tagen als kritischer Alarm. Das neue
Token muss aber **von Hand** in `.env` eingetragen und der Dienst neu gestartet
werden. Ein OAuth-Refresh-Flow ist nicht implementiert.

## 11. Der Zeitplan läuft im selben Prozess

Warteschlange, Kennzahlenabruf und Aufräumaufgaben laufen als Intervalle im
Serverprozess. Stürzt er ab, läuft nichts davon. Es gibt keinen externen
Scheduler und keine Prozessüberwachung.

**Empfehlung für Produktion:** systemd mit `Restart=always` oder Docker mit
`restart: unless-stopped` (beides in `ops/` mitgeliefert).

## 12. Zwölf Marken-Tatsachen sind unbestätigt

Gründungsjahr, Fahrlehreranzahl, beide Adressen, die Kanäle, Simulator,
behindertengerechte Ausbildung, Fuhrpark, digitale Lerninhalte, Klassendetails,
Intensivkurse — alles recherchiert, nichts bestätigt.

Das ist kein Mangel, sondern der beabsichtigte Zustand: Der Fact Verifier
blockiert jeden Beitrag, der sie verwendet, bis der Inhaber sie bestätigt.
Erwarten Sie in der ersten Woche entsprechend viele `FACT_*`-Blockaden.

## 13. Kein Mandantenbetrieb, kein Audit-Export

Eine Installation bedient einen Betrieb. Es gibt keine Mandantentrennung.
Das Ereignisprotokoll ist vollständig und unveränderlich, aber es gibt keine
fertige Exportfunktion für eine externe Prüfung — die Daten müssten per
SQL-Abfrage geholt werden.

## 14. Die Oberfläche ist auf Deutsch, ohne Umschaltung

Kein Sprachwechsel, keine Internationalisierung. Für einen deutschen Betrieb
mit deutschsprachigem Team ist das angemessen, aber es ist eine Grenze.

## 15. Barrierefreiheit ist geprüft, aber nicht zertifiziert

Getestet: Tastaturbedienbarkeit über native Elemente, Kontraste im dunklen
Schema, Tippziele ≥ 30 px auf Touch-Geräten, `prefers-reduced-motion`,
semantische Struktur, `aria-current` in der Navigation, kein horizontales
Scrollen in drei Viewports.

Nicht durchgeführt: eine formale WCAG-2.2-Prüfung und ein Test mit
Screenreadern (NVDA, VoiceOver). Für ein internes Werkzeug vertretbar — für
eine öffentliche Anwendung wäre es das nicht.
