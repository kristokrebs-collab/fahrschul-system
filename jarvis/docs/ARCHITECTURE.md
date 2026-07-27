# Architektur und Entscheidungen

## Überblick

```
┌──────────────────────────────────────────────────────────────┐
│  Web (React + Vite + Tailwind, PWA-fähig)                    │
│  Chat · Suche · Quellen · Projekte · Gedächtnis · Freigaben   │
│  Wissenskarte · Lernen · System                               │
└───────────────────────────┬──────────────────────────────────┘
                            │ same-origin, httpOnly-Cookie, SSE
┌───────────────────────────┴──────────────────────────────────┐
│  Fastify (Node 22)                                            │
│  ├─ auth        Sitzungen, TOTP, Rollen, Sperrung             │
│  ├─ orchestrator  Absicht → Suche → Gedächtnis → Modell       │
│  │                 → Werkzeugschleife → Persistenz            │
│  ├─ knowledge   Extraktion · Chunking · FTS5 · Vektoren       │
│  ├─ memory      Vorschläge, Revisionen, Verschlüsselung       │
│  ├─ tools       Registry · Safety Reviewer · Aktionen         │
│  ├─ adapters    Schwestersysteme (nur GET, Circuit Breaker)   │
│  ├─ eval        Interaktionen, Korrekturen, Regression        │
│  └─ core        Queue · Audit-Kette · Krypto · Logger         │
└───────────────────────────┬──────────────────────────────────┘
                            │
                  ┌─────────┴─────────┐
                  │  SQLite (WAL)      │  eine Datei = alles
                  │  35 Tabellen       │  Backup = VACUUM INTO
                  └────────────────────┘
```

Ein Prozess, eine Datei, keine externen Dienste im Standardbetrieb.

---

## Systemgrenzen

Drei getrennte Systeme, drei Berechtigungsdomänen:

| Domäne | Zugriff von JARVIS aus | Durchgesetzt durch |
|---|---|---|
| `general-jarvis` | voll (mit Bestätigungsregeln) | Risikoklassen + Safety Reviewer |
| `social-autopilot` | **nur lesen**, 4 freigegebene Pfade | Adapter kennt nur `GET`; Pfad-Allowlist |
| `finance-crypto` | **nur lesen**, 4 freigegebene Pfade | dito, eigener Token, eigener Breaker |

Konkret erzwungen, nicht nur dokumentiert:

* Der Adapter hat **keinen Codepfad**, der etwas anderes als `GET` sendet.
* Jede Domäne hat einen eigenen Token aus einer eigenen Umgebungsvariable.
  Tokens werden nie geloggt, nie an das Modell gegeben, nie zwischen Adaptern geteilt.
* Ein eigener Circuit Breaker pro Domäne: ein krankes Schwestersystem
  verlangsamt JARVIS nicht.
* Ist ein System nicht konfiguriert, liefert der Adapter `configured: false` und
  einen Klartexthinweis für das Modell. Es werden **nie** plausible Zahlen erfunden.

---

## Architekturentscheidungen

### ADR-1 — SQLite statt PostgreSQL

**Kontext.** Ein Einzelnutzer-System mit einigen tausend bis einigen zehntausend
Textabschnitten, das täglich laufen und ohne Betriebsteam überleben muss.

**Entscheidung.** SQLite im WAL-Modus, eine Datei.

**Begründung.**
* Sicherung ist `VACUUM INTO` — ein konsistenter Einzeldatei-Schnappschuss im
  laufenden Betrieb, ohne WAL-Beiwerk. Wiederherstellung ist ein Dateikopieren.
* Warteschlange, Audit-Log und Nutzdaten liegen in **einer** Transaktionsgrenze.
  „Job einreihen und Daten schreiben“ ist atomar; bei Postgres + Redis wäre das
  ein verteiltes Problem ohne Gegenwert.
* FTS5 liefert BM25 ohne Zusatzkomponente. Der deutsche Anwendungsfall profitiert
  von `unicode61 remove_diacritics 2` plus Präfixindizes für Komposita.
* Ein Prozess weniger, der ausfallen, altern oder ein Passwort brauchen kann.

**Preis.** Ein Schreiber zur Zeit (für einen Nutzer irrelevant); keine Netzwerk-
Replikation; Vektorsuche ohne ANN-Index (siehe ADR-3).

**Wechselpfad.** Sämtliche SQL-Zugriffe liegen in den Modulen unter
`knowledge/`, `memory/`, `projects/`, `core/`. Ein Postgres-Treiber mit `pgvector`
tauscht diese Schicht, nicht die Anwendung. Auslöser: mehrere Nutzer oder
> 100 000 Abschnitte.

### ADR-2 — Reciprocal Rank Fusion statt gewichteter Score-Mischung

**Kontext.** BM25 liefert unbeschränkte negative Werte, Kosinus liegt in
[-1, 1], und beide Skalen verschieben sich je nach Anfrage.

**Entscheidung.** RRF (`1/(60+rang)`) über beide Ergebnislisten, danach
Aktualitäts- und Beziehungsboost.

**Begründung.** Rangbasierte Fusion braucht keine Kalibrierung und ist robust,
wenn eine Quelle für eine bestimmte Anfrage schlecht funktioniert.

**Folgeproblem und Lösung.** RRF **staucht** die Abstände: jeder Treffer startet
bei ~0.0164, deshalb trennt ein Verhältnis-Test auf dem Fusionswert kaum. Der
Relevanzfilter prüft daher die **Evidenz** darunter: ein Abschnitt überlebt, wenn
er ein Stichwort getroffen hat **oder** seine Ähnlichkeit absolut *und* relativ
hoch ist. Ohne diesen Filter zitierte eine Preisfrage eine unbeteiligte
Projektnotiz — die Antwort *sah* belegt aus, war es aber nicht.

### ADR-3 — Brute-Force-Vektorsuche

**Entscheidung.** Alle Vektoren laden, Kosinus in JS, sortieren.

**Begründung.** Bei 10 000 Abschnitten × 384 Dimensionen sind das ~4 M
Multiplikationen — wenige Millisekunden, **exakt**, kein Index, der driften,
neu gebaut oder getunt werden muss. Ein ANN-Index wäre hier Komplexität ohne
messbaren Gewinn.

**Grenze.** Ab ~100 000 Abschnitten (~150 MB Vektoren) wird das spürbar. Dann:
`sqlite-vec` oder Wechsel zu `pgvector` gemäß ADR-1.

### ADR-4 — Warteschlange in SQLite statt Redis/BullMQ

**Entscheidung.** Tabelle `jobs` mit Lease, Backoff, Idempotenzschlüssel und
kooperativem Abbruch.

**Begründung.** Ein zweiter Dienst nur für Hintergrundarbeit lohnt bei diesem
Volumen nicht. Entscheidend ist das Verhalten nach einem Absturz: ein Job in
`running` ohne lebenden Worker ist beim Start eindeutig verwaist und wird
zurückgesetzt — statt bis zum Lease-Ende zu blockieren.

### ADR-5 — Vorschlag statt Autonomie beim Gedächtnis

**Entscheidung.** Nichts Dauerhaftes wird ohne genehmigten Vorschlag geschrieben.
Enge, vom Besitzer angelegte Regeln können `reversible_write` automatisieren —
niemals Löschungen und niemals `secret`.

**Begründung.** Ein Assistent, der still mitschreibt, wird zu einem Risiko, das
man nicht überblickt. Der Wortlaut wird **vor** dem Speichern gezeigt und ist
editierbar; das macht Korrektur billiger als Reue.

### ADR-6 — Ehrliche Degradierung statt Attrappen

**Entscheidung.** Fehlt ein Schlüssel, eine Integration oder ein Master-Key,
wird der Zustand benannt und die betroffene Funktion verweigert.

**Beispiele.**
* Kein Anthropic-Schlüssel → echte Quellensuche mit Zitaten, keine erfundene Prosa.
* Kein `JARVIS_MASTER_KEY` → eine `private`-Erinnerung wird **abgelehnt**, nicht
  im Klartext gespeichert.
* Kein SMTP → `send_email` wird blockiert; ein Versand wird nie gemeldet.

### ADR-7 — Sicherheit im Code, nicht im Prompt

**Entscheidung.** Bestätigungspflicht, Pfadgrenzen, Geheimnis-Filter und
Domänentrennung sind Code, der unabhängig vom Modellverhalten hält.

**Begründung.** Ein Systemprompt ist eine Bitte. Der Action Safety Reviewer läuft
regelbasiert nach dem Planer und kann durch nichts im Gespräch umgestimmt werden.

### ADR-8 — Der Modellschlüssel gehört in die Datenbank, nicht in eine Datei

**Kontext.** Claude ist der Denkapparat. Ohne Schlüssel ist JARVIS ein
Suchsystem. Der Weg vom „installiert“ zum „denkt“ darf keine Codeänderung,
keinen Editor und keinen Neubau erfordern — sonst bleibt er ungegangen.

**Entscheidung.** `ANTHROPIC_API_KEY` aus der Umgebung hat weiterhin Vorrang.
Fehlt sie, kann der Besitzer den Schlüssel zur Laufzeit hinterlegen; er landet
AES-256-GCM-verschlüsselt in `settings` unter `llm.api_key` und der
Anthropic-Client wird bei Schlüsselwechsel neu gebaut (`client.ts` merkt sich den
zuletzt benutzten Schlüssel und vergleicht ihn bei jedem Zug).

**Begründung und Randbedingungen.**
* **Erst prüfen, dann speichern.** `checkLlmKey` macht einen echten Aufruf
  (`models.retrieve`). Ein ungültiger Schlüssel wird nie persistiert — sonst
  hätte man einen stillen Ausfall, der erst im nächsten Gespräch auffällt.
  Die Formatprüfung läuft davor, weil sie lokal, kostenlos und offline möglich
  ist: ein offensichtlich falscher Wert bekommt eine nützliche Antwort statt
  „kann ich gerade nicht prüfen“.
* **Ohne Master-Key: Verweigerung.** Ein API-Schlüssel im Klartext in einer
  Datenbankdatei ist schlimmer als kein Schlüssel. Gleiche Haltung wie ADR-6.
* **Einbahnstraße.** Es gibt keinen Endpunkt, der den Schlüssel zurückgibt.
  Die Oberfläche kennt nur die Maske `sk-ant-…KJ8s` und die Herkunft.
* **Genau eine Wahrheit.** Kommt der Schlüssel aus der Umgebung, antwortet
  `POST /api/llm/key` mit `409` statt eine zweite, unwirksame Quelle anzulegen.
* Setzen und Entfernen sind `financial_security`-Ereignisse im Audit-Log —
  mit Herkunft und Maske, nie mit dem Wert.

**Preis.** Der Schlüssel liegt in derselben Datei wie die Daten und ist an
`JARVIS_MASTER_KEY` gebunden: eine Sicherung ohne diesen Master-Key stellt die
Verbindung nicht wieder her. Das ist gewollt — siehe `docs/OPERATIONS.md`.

---

## Ablauf eines Zuges

1. **Absicht klassifizieren** (deterministisch, ohne Modellaufruf) — „Guten
   Morgen“ löst keine Suche aus, eine Sachfrage schon.
2. **Private Suche** — hybrid, mit Widerspruchs- und Aktualitätsprüfung.
3. **Gedächtnis abrufen** — Vermutungen nachrangig und markiert.
4. **Injektionsprüfung** des abgerufenen Materials → setzt die Haltung für diesen Zug.
5. **Prompt bauen** — stabiler Systemprompt mit `cache_control`; alles Flüchtige
   danach, damit der Cache greift. Unvertrauenswürdiges in `<untrusted_*_nonce>`.
6. **Streamen** mit Werkzeugen; Server-Tools für Websuche, wenn erlaubt.
7. **Werkzeugschleife** — jeder Aufruf geht durch `proposeAction`:
   `read_only` läuft sofort, alles andere erzeugt eine Bestätigungskarte und
   liefert dem Modell „wurde **nicht** ausgeführt“ zurück.
8. **Persistieren** — Nachricht, Zitate, Verbrauch, Interaktionsprotokoll.

Jede Stufe kann einzeln ausfallen, ohne den Zug zu beenden.

---

## Datenmodell (Auszug)

* `sources` / `chunks` / `chunks_fts` / `embeddings` / `relations` — Wissensbasis
* `memories` / `memory_revisions` / `memory_proposals` / `memory_rules` — Gedächtnis
* `actions` — Vorschau, Freigabe, Ausführung, Ergebnis
* `jobs` — Warteschlange mit Lease und Idempotenz
* `audit_log` — hash-verkettet, `seq` fortlaufend
* `interactions` / `corrections` / `regression_cases` / `eval_runs` — Lernschleife
* `prompt_versions` — versionierte Prompts, genau eine aktiv
