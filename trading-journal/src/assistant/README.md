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

| `tools.ts` | everything that is not a plain journal question; pure functions of `ToolEnv` (data in, reply out; navigate / editor / memory / training are callbacks). `train` („Ich will üben“, „Training starten“) only OPENS the training sheet (F38); `similar` („Zeig mir ähnliche Situationen“, „gab es schon mal so eine Marktlage?“) only OPENS the Markt page at the card „Ähnliche Situationen“ (F19, `openSimilar` of `@/views/markt/similarOpen`) – it searches nothing and answers no number |
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
