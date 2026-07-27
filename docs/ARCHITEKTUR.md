# Architektur

Dieses Dokument erklärt nicht nur, *was* gebaut wurde, sondern *warum* — und wo
die Entscheidungen anders ausgefallen sind, als man es üblicherweise sieht.

---

## Leitgedanken

1. **Das Freigabe-Gate ist die wichtigste Zeile Code im System.** Alles andere
   ist Komfort. Deshalb ist es dreifach abgesichert und nicht konfigurierbar.
2. **Ein Vetorecht, das sich wegformulieren lässt, ist keines.** Die vier
   Prüfinstanzen mit Vetorecht sind deterministische Regelwerke, keine
   LLM-Aufrufe.
3. **Kein vorgetäuschter Erfolg.** Es gibt keinen Adapter, der „erfolgreich"
   meldet, ohne beim Anbieter nachgesehen zu haben. Fehlende Zugangsdaten
   führen zu einem sichtbaren Fehler, nicht zu einem stillen Überspringen.
4. **Ehrlichkeit über Unsicherheit.** Bewertungen tragen eine Konfidenz.
   Fehlende Daten senken die Konfidenz, nicht heimlich den Wert.

---

## Technischer Aufbau

```
        ┌──────────────────────── Browser (PWA) ─────────────────────────┐
        │  index.html · app.js · ui.js · views.js · sw.js                │
        │  ES-Module, kein Build-Schritt, ~40 kB                         │
        └───────────────────────────┬────────────────────────────────────┘
                                    │ HTTPS, Session-Cookie (HttpOnly)
        ┌───────────────────────────▼────────────────────────────────────┐
        │  Fastify · routes/api.ts                                       │
        │  Rollenprüfung je Route · Zod-Validierung · CSP · Rate-Limit    │
        └───────────────────────────┬────────────────────────────────────┘
                                    │
     ┌──────────────┬───────────────┼──────────────┬────────────────────┐
     │              │               │              │                    │
┌────▼────┐  ┌──────▼──────┐  ┌─────▼──────┐  ┌────▼─────┐  ┌───────────▼──┐
│ domain/ │  │  agents/    │  │  queue/    │  │workers/  │  │integrations/ │
│ Fach-   │  │ 15 Rollen   │  │ Warte-     │  │Zeitplan  │  │ IG·FB·TikTok │
│ logik   │  │ + Orchestr. │  │ schlange   │  │          │  │ ·YT·Sandbox  │
└────┬────┘  └──────┬──────┘  └─────┬──────┘  └────┬─────┘  └───────┬──────┘
     └──────────────┴───────────────┼──────────────┴────────────────┘
                                    │
                    ┌───────────────▼────────────────┐
                    │  SQLite (node:sqlite, WAL)     │
                    │  10 Migrationen · 30 Tabellen  │
                    │  Trigger als letzte Verteidigung│
                    └────────────────────────────────┘
```

---

## Warum diese Technik

### SQLite über `node:sqlite` statt PostgreSQL

Der Betrieb ist eine Fahrschule mit zwei Standorten, nicht ein Konzern. Die
Datenmenge liegt bei Tausenden Zeilen, nicht Millionen. Eine Datei mit WAL
liefert dafür alles Nötige — Transaktionen, Trigger, Fremdschlüssel,
Volltextsuche — und spart einen ganzen Betriebsprozess.

`node:sqlite` ist seit Node 22 im Kern enthalten. Damit entfällt die native
Kompilierung von `better-sqlite3`, die auf jedem Zielsystem neu scheitern kann.
Der Zugriff läuft über eine dünne Schicht in `src/db/index.ts`; ein Wechsel auf
PostgreSQL wäre ein Austausch dieser Schicht, kein Umbau der Fachlogik.

**Preis dieser Entscheidung:** ein Schreibprozess zur Zeit. Bei einem einzelnen
Betrieb ist das kein Engpass; bei mehreren Instanzen wäre PostgreSQL nötig.
Deshalb steht `ENABLE_WORKERS` in der Konfiguration — bei mehreren Instanzen
läuft der Zeitplan nur auf einer.

### PWA ohne Build-Schritt

Die Oberfläche wird auf einem Tablet im Betrieb benutzt, oft im Vorbeigehen.
Sie besteht aus reinen ES-Modulen und lädt ohne Bundler, ohne Transpiler,
ohne Hydration. Der gesamte Frontend-Code ist etwa 40 kB.

Der Renderpfad nutzt ausschließlich `document.createElement` und
`textContent` (`web/ui.js`, Funktion `h()`). Es gibt keine einzige Stelle mit
`innerHTML`. Damit ist HTML-Einschleusung aus API-Daten strukturell
ausgeschlossen, nicht bloß gefiltert.

**Preis:** kein Komponenten-Ökosystem, keine Typprüfung im Frontend. Bei zwölf
Ansichten ist das vertretbar.

### Prüfende Agenten als Regelwerke, generative Agenten mit LLM

| Rolle | Umsetzung | Grund |
|---|---|---|
| Brand Voice Guardian | Regelwerk | Das Veto muss unverhandelbar sein |
| Fact Verifier | Regelwerk | Eine Zahl ist belegt oder nicht |
| Privacy Reviewer | Regelwerk | Rechtestatus ist eine Datenbankabfrage |
| Compliance Reviewer | Regelwerk | Plattformgrenzen sind Zahlen |
| Red-Team Critic | Regelwerk | Musterbasiert, ohne Veto |
| Strategist, Researcher, Producer, Copy | Claude, sonst deterministische Komposition | Sprachliche Arbeit |

Ein LLM als Prüfinstanz hat zwei Probleme: es lässt sich durch geschickte
Formulierung überreden, und ein in einem Kommentartext versteckter Befehl kann
es beeinflussen. Ein Regelwerk kann beides nicht. Zusätzlich sind Regeln in
Millisekunden ausgeführt, kosten nichts und sind vollständig testbar — die 85
Tests decken genau diese Pfade ab.

Ohne LLM-Zugangsdaten arbeiten die generativen Agenten in einem
**deterministischen Kompositionsmodus** aus der Markendatenbank. Dieser Modus
wird in `/api/health`, in der Ansicht *Heute* und in der Ansicht *System*
offen ausgewiesen — er wird nicht als vollwertige Generierung ausgegeben.

---

## Das Freigabe-Gate im Detail

Die zentrale Idee: **eine Freigabe gilt für einen Inhalt, nicht für ein Objekt.**

```
publishRelevantView(item)   → genau die Felder, die den öffentlichen Eindruck
                              bestimmen (Plattform, Konto, Format, Text, Skript,
                              Bildtexte, Untertitel, CTA, Hashtags, Alt-Text,
                              Cover, Pin-Kommentar, Asset-IDs, Zeitpunkt)
        ↓ kanonisiert (Schlüssel rekursiv sortiert)
        ↓ SHA-256
content_hash
```

Bewusst **nicht** im Hash: interne Notizen, Shotlist, Schnittliste, nicht
gewählte Hook-Varianten. Diese ändern nichts am Ergebnis und sollen keine
unnötige Neu-Freigabe auslösen.

Drei Absicherungen:

1. **Servicelogik** (`domain/approval.ts`): prüft Rolle, blockierende Befunde,
   Rechtestatus, Kontostatus — und ob der Hash, den der Freigebende auf dem
   Bildschirm hatte, noch der aktuelle ist (`STALE_VIEW`).
2. **Hash-Bindung** (`domain/content.ts`): jede Änderung berechnet den Hash neu.
   Weicht er ab und lag eine Freigabe vor, wird sie automatisch widerrufen und
   der Zustand fällt auf `awaiting_approval`.
3. **Datenbank-Trigger** (Migration 10): `trg_publish_requires_approval` lehnt
   jeden `publish_jobs`-Eintrag ab, dessen Item nicht freigegeben ist oder
   dessen Hash nicht passt. Getestet in `approval-gate.test.ts` durch einen
   direkten `INSERT` am Servicecode vorbei.

Zusätzlich prüft der Publisher **unmittelbar vor dem Senden** noch einmal Hash,
Freigabe und Rechtestatus. Eine zwischen Einplanung und Zustellung
zurückgezogene Einwilligung bricht den Job ab — auch das ist getestet.

---

## Warteschlange und Zustellung

| Eigenschaft | Umsetzung |
|---|---|
| **Idempotenz** | `idempotency_key = sha256(itemId + approvalId)`, UNIQUE. Ein Neustart erzeugt denselben Schlüssel; eine neue Freigabe einen neuen. |
| **Neustartfestigkeit** | Zustand vollständig in der Datenbank. Verwaiste `running`-Jobs werden nach 15 Minuten wieder eingereiht. |
| **Backoff** | 30 s, 60 s, 120 s, 240 s, 480 s — gedeckelt bei 15 Minuten. `Retry-After` des Anbieters hat Vorrang. |
| **Dead-Letter-Queue** | Nach `max_attempts` oder bei nicht wiederholbarer Ursache. Erzeugt einen kritischen Alarm. |
| **Zustellprüfung** | Ein Job gilt erst als erfolgreich, wenn der Beitrag beim Anbieter gefunden wurde. „Abgesetzt, aber nicht auffindbar" ist ein Fehler, kein Erfolg. |
| **Fehlerklassen** | `missing_credentials`, `auth_expired`, `rate_limited`, `validation`, `media_processing`, `network`, `provider_error`, `unsupported`. Nur vier davon sind wiederholbar. |

---

## Die zwei Bewertungen

Der Auftrag verlangt zwei Zahlen, nicht eine. Es gibt bewusst **keine
Gesamtnote**, weil sie den einen Fall verdecken würde, auf den es ankommt:
viel Reichweite, keine Anfrage.

**Virality Score** — Reichweite im Verhältnis zur Followerzahl (30 %), Anteil
Nicht-Follower (22 %), Speicherungen (20 %), Weiterleitungen (16 %),
Wiedergabedauer (7 %), neue Follower (5 %).

**Business Impact Score** — qualifizierte Gespräche (30 %), Anmeldungen (26 %),
Termine (24 %), Absichtssignale (10 %), zurechenbarer Umsatz (10 %).

Beide normieren auf die tatsächlich vorhandenen Bestandteile und melden eine
Konfidenz (`none`/`low`/`medium`/`high`). Übersteigt die Reichweite 1000 bei
null qualifizierten Anfragen, ergänzt das System von sich aus den Satz, dass
der Beitrag unterhaltsam war, aber kein Akquiseerfolg.

---

## Selbstverbesserung mit Bremse

```
Evidenz → Vorschlag (Klartext) → Tests + historische Wiederholung
       → keine Regression → Freigabe des Inhabers → Anwendung → Rollback möglich
```

**Was das System automatisch darf:** Leistungsstatistiken fortschreiben,
Abrufgedächtnis aktualisieren, Sättigungswerte neu berechnen.

**Was es nie darf:** Freigabepflicht, Rechteprüfung, Faktenprüfung,
Plattformregeln oder Risikoschwellen abschwächen. Solche Vorschläge werden
über Mustererkennung in `FORBIDDEN_PATTERNS` (`domain/learning.ts`) als
`risk_class = 'forbidden'` eingestuft, sofort abgewiesen und sind **auch vom
Inhaber über diesen Weg nicht anwendbar** — dafür ist eine Codeänderung mit
Review nötig. Zwei Tests decken das ab.

Die Regressionssuite prüft: jedes hinterlegte *starke* Benchmark-Beispiel muss
weiterhin bestehen, jedes *schwache* weiterhin blockiert werden, und der
Freigabe-Trigger muss in der Datenbank vorhanden sein.

---

## Datenschutz im Entwurf

- **Medien:** `consent_status` und `rights_status` starten auf `UNKNOWN`. Die
  bloße Existenz einer Datei ist keine Einwilligung. Nur ein Mensch kann beides
  setzen (`setClearance`), jede Entscheidung wird protokolliert.
- **Posteingang:** Der Handle des Absenders wird nur als HMAC gespeichert.
  Wiederkehrende Personen sind erkennbar, eine durchsuchbare Namensliste
  entsteht nicht. Nach `INBOX_RETENTION_DAYS` (Standard 180) werden Text und
  Anzeigename automatisch entfernt; die anonymen Kennzahlen bleiben.
- **Protokoll:** `events` ist per Trigger unveränderlich — kein `UPDATE`, kein
  `DELETE`. Freigabe-Entscheidungen ebenfalls: Widerruf statt Löschung.
- **Logs:** Jede Zeile läuft durch `redact()`, das bekannte Token-Muster
  (Meta `EAA…`, TikTok `act.…`, Google `ya29.…`, 64-stellige Hex-Werte)
  und Schlüssel/Wert-Paare maskiert.

---

## Erweiterungspunkte

| Wunsch | Ansatzpunkt |
|---|---|
| PostgreSQL statt SQLite | `src/db/index.ts` — nur diese Datei |
| Echte Vektorsuche im Archiv | `rankResults()` in `src/domain/media.ts` |
| Weitere Plattform | `PublishAdapter` in `src/integrations/types.ts` implementieren, in `registry.ts` eintragen |
| Automatisches Antworten | `approveReply()` in `src/domain/inbox.ts` — bewusst noch ohne Versand |
| Eigene Prüfregel | Agent in `src/agents/reviewers.ts` ergänzen, in `REVIEW_AGENTS` eintragen |
