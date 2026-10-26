# `src/assistant` – the personal assistant (Bauplan F74)

One assistant for the whole app: a sheet that opens from every page (header button, key `A`, command navigation),
takes **text or microphone**, answers from the user's **own data** and learns what the user wants it to be like.
Everything numerical is computed by the app (`@/domain/…`); a language model is optional and never produces a figure.

```
question ─▶ understand.ts ─┬─ journal   ─▶ answerIntent (domain/coach/nlq)  ─▶ Answer (numbers, chart, confidence, evidence)
 (typed or     (local,     ├─ tool      ─▶ tools.ts (improve · entry · idea · lab · memory · navigate · explain · …)
  spoken)       no key)    └─ clarify   ─▶ "Meintest du …?" + closest known questions
                                   │
                                   └─ optional server router (route.ts → netlify/functions/assistant-route.mts):
                                      canonical questions → the SAME local understand() re-checks each one
```

| file | role |
|---|---|
| `understand.ts` | local language layer: typo repair (Damerau-Levenshtein against the parser's vocabulary, unique match only, "guuut" → "gut"), colloquial phrases ("was lief gut" → best setup, best weekday, biggest win), tools, follow-ups (`mergeFollowUp`: a short question inherits metric / filters / period of the last one), honest fallback |
| `tools.ts` | everything that is not a plain journal question; pure functions of `ToolEnv` (data in, reply out; navigate / editor / memory are callbacks). **Wochenexperiment** (F37): shows the accepted experiment (week, hypothesis, Sollwert, the automatic reading with its sample) or, when none is accepted for the running week, the proposal the Wochenbericht would make – read-only; accepting, declining and withdrawing stay on the report page (the action opens it) |

| `tools.ts` | everything that is not a plain journal question; pure functions of `ToolEnv` (data in, reply out; navigate / editor / memory / training are callbacks). `train` („Ich will üben“, „Training starten“) only OPENS the training sheet (F38); `similar` („Zeig mir ähnliche Situationen“, „gab es schon mal so eine Marktlage?“) only OPENS the Markt page at the card „Ähnliche Situationen“ (F19, `openSimilar` of `@/views/markt/similarOpen`) – it searches nothing and answers no number; `studio` („Strategie als Text“, „Neue Strategie“, „Strategien vergleichen“) only OPENS the page `#studio` (Strategie-Studio, F73) and says what it does – the page reads the text, asks and tests, the assistant computes and saves nothing |
| `engine.ts` | `respond(question, env)` → `Turn { replies, via, topic, needsServer }`; `execute(plan, …)` re-enters for the router's questions |
| `memory.ts` | what the assistant learns, kept in the passthrough key `settings.assistant` (style, interest counts, facts told to remember, voice flag) – survives backup / cloud `merge3`; learns only from what the user asks and says, never from trades |
| `conversation.ts` | zustand: the chat (survives closing the sheet and page changes) and the memory mirror (debounced write-back, one settings save per burst) |
| `speech.ts` | `SpeechRecognition` push-to-talk (no app-side recording or storage; the browser's recogniser does the work, and the UI says so) and optional `speechSynthesis` read-aloud; every failure has a German reason |
| `route.ts` | client of the optional router: shown only with cloud + signed in + plan `coachAi` + a server key |
| `open.ts` | tiny open-state store (header button / shortcut import it without loading the chunk) |
| `AssistantHost.tsx`, `AssistantAnswer.tsx` | the sheet (lazy chunk mounted by `DeferredHosts`) and the reply views (answer style `kurz` / `normal` / `detail` trims facts, chart, confidence, evidence) |

## Server router (`netlify/functions/assistant-route.mts`)

`POST /api/v1/assistant/route` – forced tool call `route` returning ≤ 3 **canonical German questions** from a fixed
catalogue (+ an optional clarification). Sent: the question, the last 3 questions (text), the page name and the NAMES of
the user's setups / assets – no trades, no amounts. Guards as `coach-ask`: login (aal2 if enrolled), plan feature
`coachAi` (Premium; open while payments are not configured), 20 calls / 10 min, the plan's `coachAiPerDay` shared with the
coach wording, body ≤ 4 KiB. Env: `ANTHROPIC_API_KEY` (the operator's key – buyers need none), optional `ROUTER_MODEL`
(default `COACH_MODEL`, then `claude-opus-5-5`). Without the key the assistant is fully usable on the local layer.

## What the assistant does not do

* no figure from a language model; tools and answers are deterministic functions of the journal;
* the week experiment is never accepted, declined or changed by the assistant;
* no state-changing action without the user: "öffne …" navigates and "Trade eintragen" opens the form, nothing is saved,

* no state-changing action without the user: "öffne …" navigates, "Trade eintragen" opens the form and "Teste diese Idee" (`ideaTool`, F12) only pre-fills the lab's "Eigene Idee" from the live entry check and opens the lab – nothing is saved or started,
  alerts are not created by voice (planned with confirmation);
* no background listening; the microphone runs only between two taps.

## Tests

`tests/unit/assistant.understand.test.ts` (typos, phrases, tools, follow-ups, memory), `tests/unit/assistant.route.test.ts`
(the function against fake Supabase and Anthropic clients), `tests/e2e/assistant.spec.ts` (sheet, voice stub, memory, navigation).

## „Wo finde ich …?“ (Funktionsregister)

Werkzeug `where` (`tools.ts` `whereTool`, additiv): beantwortet Ortsfragen („Wo finde ich den Belastungstest?“, „Wie komme ich zum Positionsrechner?“, „Wo kann
ich ein Backup machen?“, „Welche Funktionen gibt es?“) **nur aus dem Register** (`src/app/features.ts`, `whereIs`). Ein klarer Treffer wird geöffnet
(`ToolEnv.openFeature` → `featureOpen.openFeature`: Seite + Scrollen zur Karte, oder das Sheet) und mit Nutzensatz, Tarif, Lücke und Voraussetzung genannt; bei
mehreren nahen Treffern erscheinen die besten drei als Knöpfe und nichts öffnet sich; ohne Treffer sagt der Assistent das und verweist auf die Liste;
ohne Gegenstand („Welche Funktionen gibt es?“) öffnet er die Seite „Funktionen“. In `understand.ts` steht die Regel vor den anderen Werkzeugen (der genannte
Gegenstand – „Einstiegs-Check“, „Üben“ – darf das Gegenstands-Werkzeug nicht auslösen); die lockere Form „wo ist / wo sind …“ gilt nur ohne eigenen
Journal-Gegenstand und nie für die umgangssprachlichen Journalfragen („wo sind meine Schwächen“). Der Leerzustand des Sheets trägt den leisen Link „Alle
Funktionen ansehen →“. Gelernt wird nur das Thema `where` (Zähler), nichts über den Gegenstand. Tests: `tests/unit/assistant.where.test.ts`.

## Auswertungen (Prüfbericht, Belastung, Forward-Test, Trendlinien, Signale, Nutzen, Situationen, Passt zu dir?, Bibliothek)

Der Assistent beantwortet die fertigen Auswertungen der App. „Intelligent“ heißt: er versteht die Frage (Umgangssprache, Tippfehler, Folgefragen), holt die ZAHLEN aus den vorhandenen deterministischen Funktionen und formuliert eine kurze Antwort mit Stichprobe und Unsicherheit plus einem Knopf, der die Stelle öffnet. Nie eine Zahl aus einem Sprachmodell; gespeichert oder gestartet wird nichts (nur öffnen / navigieren; „In Eigene Idee laden“ füllt nur den Entwurf, mit dem Weg zurück des Idee-Banners).

| Werkzeug | Fragen (Beispiele) | Quelle der Zahlen | Öffnen |
|---|---|---|---|
| `audit` | „Hängt mein Backtest an wenigen Trades?“, Datenlücken, Prüfzeiträume | `auditRun` (`@/domain/lab/report`) auf dem letzten Labor-Lauf | Prüfbericht |
| `stress` | „Wie lang war die längste Verlustserie?“, Belastungstest, Filtervergleich | `lossStreakStress`; Szenarien und Filter **nur**, wenn in `useExtras` schon gerechnet | Belastungstest |
| `forward` | „Wie läuft mein Forward-Test?“, „Hält das virtuelle Konto, was der Backtest zeigt?“ | `accountView`; `compareForward` nur, wenn der Vergleich im Konto schon gerechnet ist | Forward-Test |
| `trend` | Annäherung / Bruch / Retest je Zeiteinheit, Abstand zur nächsten Linie, gesperrte Zeiteinheiten mit Grund | `getTrendlines()` (`analyzeTrendlines`, `describeLine`) | Preis- und RSI-Struktur |
| `signals` | ausgelassen und warum, Trefferquote der Box-Setups, verpasste Signale mit Ziel zuerst | `buildInbox`, `buildBalance`, `matchSignals` über das Signalarchiv; Ausgänge **nur** aus Cache / Sitzung (die App wertet sie selbst aus, `views/coach/signalAuto.ts`); fehlt etwas, nennt die Antwort den Stand („x von y ausgewertet“) – der Assistent rechnet und lädt nichts | Posteingang, Bilanz, Verpasste Chancen |
| `quality` | „Wie lange war die App letzten Monat offen?“, Alarme über 5 Minuten Verspätung | `qualityReport` (30 Tage, kein Kalendermonat – so gesagt) | Daten- und Alarmqualität |
| `benefit` | „Was hat mir das Journal im September gebracht?“ | `monthBenefit` | Monatsbericht |
| `situation` | „Wie ging es nach ähnlichen Situationen weiter?“ | `findSimilar` (`headline`, Gegenbeispiele, `fewText`) | Karte (das bestehende `similar`-Werkzeug öffnet sie nur) |
| `fit`, `demands` | „Passt diese Strategie zu mir?“, „Was verlangt die Idee von mir?“ | `compareFit` (`FitItem.text`), `strategyFacts` | Passt zu dir? |
| `discovery` | „Was haben meine Gewinner gemeinsam?“, „Was haben meine Verlierer gemeinsam?“, „Gibt es Muster bei meinen Verlierern?“ | die **zuletzt fertig gerechnete** Suche des Muster-Entdeckers dieser Sitzung (`src/views/discovery/lastResult.ts`): Zahl der Prüfungen, bestätigte Muster mit Treffer, Stichprobe und Stand – der Assistent startet die Suche nicht; gibt es keine, nennt er die Zahl der Journal-Trades gegen das Minimum (80) | Muster-Entdecker (Labor) |
| `evolve` | „Verbessere meine Strategie im Hintergrund“, „Was hat der Optimierer gefunden?“, „Was hat der Optimierer gelernt?“ | `settings.evolve` über `@/domain/evolve/config` + `learned` (offene Vorschläge mit Überanpassungs-Wahrscheinlichkeit und Stichprobe, Versuchszähler, Entscheidungs- und Live-Quote erst ab Mindeststichprobe); startet nichts und entscheidet nichts | Hintergrund-Optimierer öffnen |
| `library` | „Gibt es eine Strategie mit Bollinger?“, „Welche Werte nimmt man für die Supertrend-Strategie?“ | `@/domain/lab/library` (Karte, typische Werte, tolerant gegen Tippfehler) | „In Eigene Idee laden“, Bibliothek |

**Aufbau.** `insightRoutes.ts` (Routing, klein, Teil des Assistenten-Chunks; Wortvergleich mit Tippfehler-Toleranz, `fuzzy.ts`) → `engine.ts` (`Turn.later`: die Antwort kommt asynchron, der Eintrag zeigt solange den Warte-Takt; `settled(turn)` wartet auf beides) → `insights/index.ts` lädt je Thema eine eigene Datei und diese ihre Datenquelle erst beim Fragen (`insights/sources.ts`: Labor-Store, Extras-Store, `settings.forward`, Trendlinien-Store, Signalarchiv, Marktfeed). Tests übergeben die Eingaben über `ToolEnv.insight`. Erstladung: +0,6 KiB (Chunk-Liste des Preload-Verzeichnisses), sonst alles lazy.

**Routing ohne falsche Treffer.** Die Regeln stehen hinter „Wo finde ich …?“ und den Gedächtnis-Befehlen, vor den älteren Werkzeugen. „Win-Rate am Montag“ und alle Journalfragen haben keines der Substantive; was es im Journal UND im Labor gibt (Verlustserie), geht nur dann ins Labor, wenn die Frage den Lauf nennt oder kein „mein / im Journal“ sagt – ohne Lauf bietet die Antwort die Journalfrage als Knopf an. „Zeig mir ähnliche Situationen“ öffnet weiter nur die Karte (`similar`); erst Fragen nach dem Verlauf („wie ging es … weiter“, „Gegenbeispiele“) werden ausgewertet. Folgefragen: „und letzte Woche?“ nach einer Signal-, Qualitäts- oder Nutzen-Antwort setzt die alte Frage mit dem neuen Zeitraum fort (der zuletzt genannte Zeitraum gewinnt, `insights/period.ts`).

**Ehrlichkeit.** Jede Antwort nennt die Stichprobe; ohne Daten (kein Lauf, leeres Archiv, Markt nicht verbunden, zu wenig Fundstellen) sagt sie das und verweist darauf, wo man es startet. Ob ein Signal bewusst ausgelassen oder übersehen wurde, weiß die App nur dort, wo der Nutzer „Ausgelassen – Grund“ gesetzt hat.

**Lernen.** Das Gedächtnis zählt weiter nur, wonach der Nutzer fragt (`plan.topic`, jetzt auch `audit`, `stress`, `forward`, `trend`, `signals`, `quality`, `benefit`, `situation`, `fit`, `library`, `evolve`). Die Chips (`suggestFor`) bieten zu den meistgefragten Themen die passende Frage an (`INTEREST_QUESTION`); im Gedächtnis-Bereich der Sheet-Oberfläche steht „Was dich interessiert“ mit Klartext-Namen und Zähler, jedes Thema einzeln löschbar, dazu „Interessen löschen“ (`interests.ts`; Notizen, Stil und Vorlesen bleiben).

Tests: `tests/unit/assistant.tools.test.ts` (Routing mit Tippfehlern und Gegenbeispielen, Antworten auf Fixture-Daten mit handgerechneten Zahlen, Standard-Quellen, Lernen), `tests/e2e/assistant.spec.ts` („Assistent · Auswertungen“, mobil + Desktop).

## Morgenbriefing (F43)

Werkzeug `briefing` (Auswertungs-Werkzeug in `insights/briefing.ts`): „Morgenbriefing“, „Was ist heute wichtig?“, „Was steht heute an?“, „Termine heute“, „Morning note“. Die Antwort ist das Briefing der Karte „Heute wichtig“ (Markt-Seite) in wenigen Sätzen aus **derselben** Funktion (`buildBriefing` + `briefingParagraph`, `@/domain/events`) und denselben Speichern (`briefingSource` in `insights/sources.ts`: Live-Ticker, bereits geladene Tageskerzen, Schlüsselmarken, Zustellprotokoll, Tagesjournal – der Assistent lädt und startet nichts); jeder Satz mit Quelle und Zeit in eckigen Klammern, Fehlendes „keine Daten“, am Ende „Keine professionelle Finanzberatung.“. Der Knopf „Briefing mit allen Quellen öffnen“ öffnet die Karte (Funktion `morgenbriefing`). Tests: `tests/unit/assistant.briefing.test.ts`, e2e `tests/e2e/termine.spec.ts`.
