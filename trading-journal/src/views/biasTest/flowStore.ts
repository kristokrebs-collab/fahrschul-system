/**
 * UI state of "Chart spiegeln / Bias prüfen" (F62). In memory: the running test (one at a time) and the free mirror of
 * each surface. Per device in `localStorage` (try/catch via `@/store/storage`): the layer choice and the RSI option per
 * surface (`storageKey("bias-view")`) – never the flip itself, a chart always opens the right way up.
 *
 * Test records live in the synced journal (`settings.biasTests`, `@/domain/biasTest`), never here. The order is the
 * point: `submitFirst` writes the first answer BEFORE the chart turns, `submitSecond` writes the second BEFORE the original
 * view comes back; a write that fails leaves the test where it was.
 */
import { create } from "zustand";
import { DEFAULT_MIRROR_LAYERS, MIRROR_LAYER_KEYS, type MirrorLayers } from "@/chart/mirror";
import {
  EMPTY_DRAFT,
  NO_BLIND,
  answerOfDraft,
  biasTestOf,
  newBiasTest,
  withBiasTest,
  withOutcome,
  withSecondAnswer,
  withoutOpenBiasTest,
  type AnswerDraft,
  type BiasBlind,
  type BiasContext,
  type BiasSurface,
  type BiasTest,
  type OutcomeValue,
} from "@/domain/biasTest";
import { newId } from "@/lib/ids";
import { useJournal } from "@/store/journalStore";
import { readJsonDetailed, storageKey, writeJson } from "@/store/storage";
import { pushToast } from "@/store/uiStore";
import { BIAS } from "./strings";

export const VIEW_KEY = storageKey("bias-view");

/** The Markt chart has no trade markers today, so "Eigene Trades" starts off there; every other signal starts on. */
export const DEFAULT_LAYERS: Readonly<Record<BiasSurface, MirrorLayers>> = {
  markt: { ...DEFAULT_MIRROR_LAYERS, trades: false },
  replay: { ...DEFAULT_MIRROR_LAYERS },
};

export type Phase = "setup" | "first" | "flipped" | "revealed";

export interface Flow {
  surface: BiasSurface;
  phase: Phase;
  /** what is covered while the test runs (chosen in the setup, frozen with the first answer) */
  blind: BiasBlind;
  /** layers and the RSI option the test runs with (chosen in the setup) */
  layers: MirrorLayers;
  rsiMirrored: boolean;
  /** set when the picture is frozen (phase `first`) */
  context: BiasContext | null;
  /** the stored test once the first answer is saved */
  testId: string | null;
  draft: AnswerDraft;
  /** the user tried to save an incomplete answer: the gaps are shown */
  showGaps: boolean;
  saving: boolean;
  /** the finished test (phase `revealed`) */
  result: BiasTest | null;
}

export interface SurfacePrefs {
  layers: MirrorLayers;
  rsiMirrored: boolean;
}

interface BiasUi {
  /** the free mirror (no test) per surface */
  flipped: Record<BiasSurface, boolean>;
  prefs: Record<BiasSurface, SurfacePrefs>;
  flow: Flow | null;

  setFlipped(surface: BiasSurface, on: boolean): void;
  setLayer(surface: BiasSurface, key: keyof MirrorLayers, on: boolean): void;
  setRsiMirrored(surface: BiasSurface, on: boolean): void;

  /** opens the setup (blind options) of a test on `surface` */
  beginSetup(surface: BiasSurface): void;
  setBlind(patch: Partial<BiasBlind>): void;
  /** freezes the picture at `context` and starts step 1 */
  startFirst(context: BiasContext): void;
  setDraft(patch: Partial<AnswerDraft>): void;
  /** continues an unfinished test on its surface (phase `flipped`: the first answer is already saved) */
  resume(test: BiasTest): void;
  /** the test is dropped from the screen; a stored first answer stays (the history offers to continue or discard it) */
  leave(): void;
  /** the free flip and a running test are mutually exclusive */
  flowOn(surface: BiasSurface): Flow | null;
}

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);

function loadPrefs(): Record<BiasSurface, SurfacePrefs> {
  const base = { markt: { layers: { ...DEFAULT_LAYERS.markt }, rsiMirrored: false }, replay: { layers: { ...DEFAULT_LAYERS.replay }, rsiMirrored: false } };
  const r = readJsonDetailed<unknown>(VIEW_KEY);
  if (r.status !== "ok" || !isObj(r.value)) return base;
  for (const s of ["markt", "replay"] as const) {
    const o = r.value[s];
    if (!isObj(o)) continue;
    const layers = isObj(o.layers) ? o.layers : {};
    for (const k of MIRROR_LAYER_KEYS) if (typeof layers[k] === "boolean") base[s].layers[k] = layers[k];
    base[s].rsiMirrored = o.rsiMirrored === true;
  }
  return base;
}

function savePrefs(p: Record<BiasSurface, SurfacePrefs>): void {
  writeJson(VIEW_KEY, p);
}

const freshDraft = (): AnswerDraft => ({ ...EMPTY_DRAFT });

export const useBiasUi = create<BiasUi>()((set, get) => ({
  flipped: { markt: false, replay: false },
  prefs: loadPrefs(),
  flow: null,

  setFlipped: (surface, on) => set((s) => ({ flipped: { ...s.flipped, [surface]: on } })),
  setLayer: (surface, key, on) => {
    const prefs = { ...get().prefs, [surface]: { ...get().prefs[surface], layers: { ...get().prefs[surface].layers, [key]: on } } };
    savePrefs(prefs);
    set({ prefs });
  },
  setRsiMirrored: (surface, on) => {
    const prefs = { ...get().prefs, [surface]: { ...get().prefs[surface], rsiMirrored: on } };
    savePrefs(prefs);
    set({ prefs });
  },

  beginSetup: (surface) => {
    const p = get().prefs[surface];
    set((s) => ({ flipped: { ...s.flipped, [surface]: false }, flow: { surface, phase: "setup", blind: { ...NO_BLIND }, layers: { ...p.layers }, rsiMirrored: p.rsiMirrored, context: null, testId: null, draft: freshDraft(), showGaps: false, saving: false, result: null } }));
  },
  setBlind: (patch) => set((s) => (s.flow ? { flow: { ...s.flow, blind: { ...s.flow.blind, ...patch } } } : s)),
  startFirst: (context) => set((s) => (s.flow && s.flow.phase === "setup" ? { flow: { ...s.flow, phase: "first", context, draft: freshDraft(), showGaps: false } } : s)),
  setDraft: (patch) => set((s) => (s.flow ? { flow: { ...s.flow, draft: { ...s.flow.draft, ...patch } } } : s)),
  resume: (test) => {
    const surface = test.context.surface;
    set((s) => ({
      flipped: { ...s.flipped, [surface]: false },
      flow: { surface, phase: "flipped", blind: { ...test.blind }, layers: { ...test.layers }, rsiMirrored: test.rsiMirrored, context: test.context, testId: test.id, draft: freshDraft(), showGaps: false, saving: false, result: null },
    }));
  },
  leave: () => set({ flow: null }),
  flowOn: (surface) => {
    const f = get().flow;
    return f && f.surface === surface ? f : null;
  },
}));

/* ------------------------------------------------------------------ writes */

const fail = (title: string) => pushToast({ kind: "error", title, detail: "Bitte noch einmal versuchen." });

async function saveSettings(next: ReturnType<typeof withBiasTest>): Promise<boolean> {
  try {
    await useJournal.getState().saveSettings(next);
    return true;
  } catch {
    return false;
  }
}

const storedTest = (id: string): BiasTest | null => {
  const raw = (useJournal.getState().settings as { biasTests?: { tests?: unknown[] } }).biasTests?.tests?.find((x) => isObj(x) && x.id === id);
  return biasTestOf(raw);
};

/**
 * Step 1 → 2: stores the first answer (with its timestamp) and only then turns the chart. Resolves `true` when saved.
 * An incomplete answer is not saved (`showGaps`); a failed write keeps the test on step 1.
 */
export async function submitFirst(now: number = Date.now()): Promise<boolean> {
  const f = useBiasUi.getState().flow;
  if (!f || f.phase !== "first" || !f.context || f.saving) return false;
  const first = answerOfDraft(f.draft, now);
  if (!first) {
    useBiasUi.setState({ flow: { ...f, showGaps: true } });
    return false;
  }
  const test = newBiasTest({ id: newId("bt_"), context: f.context, blind: f.blind, layers: f.layers, rsiMirrored: f.rsiMirrored, first });
  useBiasUi.setState({ flow: { ...f, saving: true } });
  const ok = await saveSettings(withBiasTest(useJournal.getState().settings, test));
  const cur = useBiasUi.getState().flow;
  if (!ok) {
    fail(BIAS.failed);
    if (cur) useBiasUi.setState({ flow: { ...cur, saving: false } });
    return false;
  }
  // the user may have left in the meantime: the first answer is stored either way
  if (cur && cur.phase === "first") useBiasUi.setState({ flow: { ...cur, phase: "flipped", testId: test.id, draft: freshDraft(), showGaps: false, saving: false } });
  return true;
}

/**
 * Step 2 → reveal: stores the second answer and the reveal time in one write, then lets the original view back.
 * Resolves the finished test, or `null` (incomplete / write failed / answer already stored).
 */
export async function submitSecond(now: number = Date.now()): Promise<BiasTest | null> {
  const f = useBiasUi.getState().flow;
  if (!f || f.phase !== "flipped" || !f.testId || f.saving) return null;
  const second = answerOfDraft(f.draft, now);
  if (!second) {
    useBiasUi.setState({ flow: { ...f, showGaps: true } });
    return null;
  }
  const stored = storedTest(f.testId);
  const done = stored ? withSecondAnswer(stored, second) : null;
  if (!done) {
    fail(BIAS.failed);
    return null;
  }
  useBiasUi.setState({ flow: { ...f, saving: true } });
  const ok = await saveSettings(withBiasTest(useJournal.getState().settings, done));
  const cur = useBiasUi.getState().flow;
  if (!ok) {
    fail(BIAS.failed);
    if (cur) useBiasUi.setState({ flow: { ...cur, saving: false } });
    return null;
  }
  if (cur && cur.phase === "flipped") useBiasUi.setState({ flow: { ...cur, phase: "revealed", saving: false, result: done } });
  return done;
}

/** The trader's own later note on what the price did after the anchor. */
export async function recordOutcome(id: string, value: OutcomeValue, note: string, now: number = Date.now()): Promise<boolean> {
  const t = storedTest(id);
  const next = t ? withOutcome(t, value, note, now) : null;
  if (!next) return false;
  const ok = await saveSettings(withBiasTest(useJournal.getState().settings, next));
  if (!ok) fail(BIAS.failed);
  return ok;
}

/** Drops an UNFINISHED test (a finished one is a record and stays). */
export async function discardOpenTest(id: string): Promise<boolean> {
  const s = useJournal.getState().settings;
  const next = withoutOpenBiasTest(s, id);
  if (next === s) return false;
  const ok = await saveSettings(next);
  if (!ok) fail(BIAS.failed);
  else if (useBiasUi.getState().flow?.testId === id) useBiasUi.getState().leave();
  return ok;
}
