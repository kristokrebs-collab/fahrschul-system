# `src/onboarding` – first-run tour (P13)

Six short steps that set the journal up for real, then get out of the way: **Start → Konten & Kapital → Setups →
Börse → Mehr → Ziel**. Only on the first run, after the intro, skippable at every step, restartable from the settings, the
search ("Einführung starten") and the shortcut sheet.

## Wiring (integrator)

```tsx
// App.tsx, after <SetupEditor/>, before <Celebrate/>
import { OnboardingHost } from "@/onboarding/OnboardingHost";
<OnboardingHost />

// SettingsView: the card "Einführung & Hilfe" (start the tour, the most important keys, all shortcuts)
import { OnboardingCard } from "@/onboarding";
<OnboardingCard />
```

e2e helpers that seed a journal should also seed `tj2-onboarding` = `{"status":"done","at":"","v":1}` – the tour never
starts for a journal WITH trades anyway (it marks the trader `seen`), but an empty-journal spec would otherwise meet it.

## Behaviour

- **Auto start** (`autoStartDecision`, pure + tested): journal loaded AND empty, nothing stored under
  `storageKey("onboarding")`, the intro settled (`useIntroSettled`), no editor / setup editor / trade detail / command
  navigation open → `start`. A journal with trades → `seen` (existing traders are never interrupted, even before the
  intro ends). Anything still loading → `wait`. Stored outcome → `never`.
- **Stored outcome** `{ status: "done" | "skipped" | "seen", at, v: 1 }`. A skipped re-run never downgrades an earlier `done`.
- **Steps** (`steps.tsx`, copy in `TOUR`):
  1. *Start* – `LaunchGrid` (the start cards + a slot word), `AsciiCascade` wordmark "WILLKOMMEN", `PixelTextFill`
     claim, `Typewriter` HUD. The panel is a dark island (`data-theme-scope="dark"`) in both themes.
  2. *Konten & Kapital* – Makro / Scalp start capital (German amounts: `parseAmount("25.000,50")`) and the currency;
     written to `settings.capital` / `settings.currency` on "Weiter" (invalid input blocks with an inline error).
  3. *Setups* – the existing Entscheidungsgrundlagen with their rule count; "Eigene Grundlage anlegen" pauses the tour,
     opens the setup editor and resumes on the same step when it closes (`OnboardingHost`).
  4. *Börse* – with the cloud (P09) and the page `konto` registered: a link to connect an exchange (P11). Without: the
     honest hint "Du trägst Trades selbst ein …" – no fake connection.
  5. *Mehr* – what else there is, in four honest lines (Handelsplan, Aktien, Labor with the Zeitmaschine, Datenarchiv – said to be off until switched on in the
     settings) and where everything is listed ("Funktionen", menu, key `/`). One quiet button, "Demo mit Beispieldaten": it closes the tour early
     (stored as `skipped`, never as `done`) and opens the demo – its chunk is fetched on the click. Nothing here starts by itself, and the step is not
     shown to existing traders (their journal has trades: no tour).
  6. *Ziel* – one process / limit goal from `GOAL_TEMPLATES` (checklist, max 3 trades a day, plan) or none; "Halten zum
     Starten" (`HoldButton`, 1.2 s) adds it through P08 `addGoalFromDraft` (`source: { kind: "onboarding" }`), fires
     `celebrateRecord` from the button and the toast "Startklar".
- **Progress**: a horizontal `MilestoneRail` (all six fit the sheet) and the dot-matrix counter `1:6` in the header.
  Steps change with `AnimatePresence mode="wait"` (transform / opacity; reduced motion: instant).
- The tour is a `Sheet` (bottom sheet on phones, centred from `sm`): focus trap, Escape / back / swipe close = skip.

## Files

`onboardingStore.ts` (zustand + storage, `startOnboarding` / `pauseOnboarding` / `resumeOnboarding` / `finishOnboarding`
/ `skipOnboarding` / `markSeen` / `goToStep`), `steps.tsx` (the six step views + `GOAL_TEMPLATES`, `parseAmount`),
`OnboardingTour.tsx` (lazy chunk), `OnboardingHost.tsx`, `OnboardingCard.tsx`.

## Tests

`tests/unit/onboarding.store.test.tsx` (decision table, storage, pause/resume, amounts, goal templates valid for P08),
`tests/unit/onboarding.tour.test.tsx` (auto start, the five steps with real writes, editor round trip, the hold,
skip / back, no start with trades); e2e `tests/e2e/onboarding.spec.ts` (a real pointer hold) and the tour scans in
`tests/e2e/a11y.spec.ts` (dark + light).

## Demo mit Beispieldaten (F58)

In der Karte „Einführung & Hilfe“ gibt es neben dem Start der Tour den Knopf „Demo mit Beispieldaten“ (`data-testid="onboarding-demo"`). Er lädt den Demo-Chunk erst beim Klick
(`import("@/views/demo/demoStore")`) und ändert weder den Stand der Tour noch Einstellungen oder das Journal (`src/views/demo/README.md`).

## Neue Bereiche für alle, die die Tour schon kennen (Runde 8)

Wer schon Trades hat, sieht die Tour nie von selbst. Für sie gibt es drei ruhige, überspringbare Wege, ohne Fenster und ohne Startseite zu berühren:
das kleine „Neu“ an Handelsplan, Aktien und Strategie-Studio in der Navigation (verschwindet, sobald die Seite einmal geöffnet war; nur in diesem Browser,
`storageKey("visited-pages")`, `src/app/CommandNav.tsx`), die Zeile „Neu in der App“ in der Karte „Einführung & Hilfe“ (Handelsplan, Aktien, Zeitmaschine, Datenarchiv
als Direktlinks über das Funktionsregister) und der Knopf „Demo mit Beispieldaten“ ebendort sowie auf der Seite „Funktionen“.
