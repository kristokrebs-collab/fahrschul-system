/**
 * Strategie-Studio · the page on REAL BTCUSDT 4h bars served through the lab's own loader: write a text → "Verstehen" shows what
 * was understood (own words marked), what is unclear, the questions and the assumptions → answer chips complete the rules →
 * the backtest runs and ends in the honest result card → "Als Entwurf speichern" makes v1, v2 … → several strategies side by
 * side, "Alle testen" with the number compared and the multiple-testing note, paper accounts for all (never an order).
 */
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { readFileSync } from "node:fs";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { forwardOfSettings } from "@/domain/forward";
import { defaultCustom, newGroup, newLeaf, sanitizeCustom } from "@/domain/lab";
import { defaultParams, sanitizeParams } from "@/domain/lab/rules/blocks";
import type { CustomConfig, Leaf } from "@/domain/lab";
import { parseStrategyText, studioOfSettings } from "@/domain/strategytext";
import type { BinanceRest } from "@/market/sources/binance";
import { MorphDialogProvider } from "@/motion/MorphDialog";
import { MotionRoot } from "@/motion/MotionRoot";
import { useJournal } from "@/store/journalStore";
import { __resetLabor, __setHistoryDeps, useLabor } from "@/views/labor";
import { __resetForwardRuntime } from "@/views/labor/forward/forwardStore";
import { __resetStudio, EXAMPLES, flushStudio, saveStrategyVersion, StudioView, useStudio } from "@/views/studio";
import { bootFixtureJournal, installDomPolyfills } from "./views.overview.harness";

type Row = [number, number, number, number, number];
const read = (n: string): Row[] => (JSON.parse(readFileSync(`tests/unit/fixtures/${n}`, "utf8")) as { bars: Row[] }).bars;
const H4_ROWS = read("binance-btcusdt-4h.json");
const D1_ROWS = read("binance-btcusdt-1d.json");
const LAST_OPEN = H4_ROWS[H4_ROWS.length - 1]![0] * 1000;
const NOW = LAST_OPEN + 14_400_000 + 60_000;

function fixtureRest(): BinanceRest {
  return {
    klines: vi.fn(async (_s: string, interval: string, p: { startTime?: number; limit?: number } = {}) => {
      const src = interval === "4h" ? H4_ROWS : interval === "1d" ? D1_ROWS : [];
      const rows = src.filter((b) => b[0] * 1000 >= (p.startTime ?? 0)).slice(0, p.limit ?? 500);
      return { data: rows.map(([t, o, h, l, c]) => ({ time: t * 1000, open: o, high: h, low: l, close: c, volume: 1, closed: true })), asOf: NOW, receivedAt: NOW, source: "binance", comparable: true };
    }),
    fundingRate: vi.fn(async () => ({ data: [], asOf: NOW, receivedAt: NOW, source: "binance", comparable: true })),
  } as unknown as BinanceRest;
}

const RSI_TEXT = "Long, wenn der RSI unter 45 liegt und der Kurs über dem EMA 50 liegt, Stop 1,5 ATR, Ziel 2R";
const RSI_TEXT_2 = "Long, wenn der RSI unter 35 liegt, Stop 1,5 ATR, Ziel 2R";
const RSI_TEXT_3 = "Short, wenn der RSI über 60 liegt, Stop 1,5 ATR, Ziel 2R";

function renderStudio() {
  return render(
    <MotionRoot>
      <MorphDialogProvider>
        <StudioView />
      </MorphDialogProvider>
    </MotionRoot>,
  );
}

const type = (text: string): void => {
  fireEvent.change(screen.getByTestId("studio-text"), { target: { value: text } });
};
const understand = (): void => {
  fireEvent.click(screen.getByTestId("studio-understand"));
};

/** Saves a strategy with one version straight into the settings (what the page's save button does). */
async function seed(name: string, text: string, answers: Record<string, string> = {}) {
  const p = parseStrategyText(text, { answers });
  const res = await saveStrategyVersion(null, { name, text, answers, symbol: "BTCUSDT", period: "6m" }, { text, answers, setup: p.setup, config: p.rules });
  if (!res.ok) throw new Error(res.error);
  return res.id;
}

const stored = () => studioOfSettings(useJournal.getState().settings).strategies;

beforeAll(() => {
  installDomPolyfills();
  HTMLCanvasElement.prototype.getContext = (() => null) as unknown as typeof HTMLCanvasElement.prototype.getContext;
  window.scrollTo = vi.fn() as never;
});

describe("Strategie-Studio", () => {
  beforeEach(async () => {
    await bootFixtureJournal();
    localStorage.clear();
    __resetLabor();
    __resetForwardRuntime();
    __resetStudio();
    vi.useFakeTimers({ toFake: ["Date"], now: NOW });
    __setHistoryDeps({ rest: () => fixtureRest(), proxy: () => null, store: () => null, now: () => NOW });
    useLabor.getState().setCfg({ strategy: "custom", period: "6m", funding: "none" });
  });
  afterEach(() => {
    __resetLabor();
    __resetForwardRuntime();
    __resetStudio();
    __setHistoryDeps(null);
    vi.useRealTimers();
  });

  it("starts empty: the editor, no result card yet, and the list says where to begin", async () => {
    renderStudio();
    expect(await screen.findByTestId("studio-view")).toBeInTheDocument();
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent("Strategie-Studio");
    expect(screen.getByTestId("studio-list-empty")).toBeInTheDocument();
    expect(screen.getByTestId("studio-understand")).toBeDisabled();
    expect(screen.queryByTestId("studio-understanding")).toBeNull();
    expect(screen.queryByTestId("studio-backtest")).toBeNull();
  });

  it("Verstehen: the brief's sentence becomes rules; the trader's own words are marked, nothing is unclear, the assumptions are listed", async () => {
    renderStudio();
    await screen.findByTestId("studio-view");
    type(EXAMPLES[0]!.text);
    understand();
    const card = await screen.findByTestId("studio-understood");
    const items = within(card).getAllByTestId("studio-understood-item");
    expect(items.map((i) => i.getAttribute("data-kind"))).toEqual(["side", "condition", "condition", "stop", "target", "filter"]);
    expect(card).toHaveTextContent("RSI unter 30 fällt");
    expect(card).toHaveTextContent("RSI(14) kreuzt nach unten 30");
    // the marked text carries the same words
    const marks = within(screen.getByTestId("studio-marked")).getAllByText((_, el) => el?.tagName === "MARK");
    expect(marks.length).toBeGreaterThanOrEqual(6);
    expect(screen.getByTestId("studio-unclear")).toHaveTextContent("Alles, was du geschrieben hast, ist einer Regel zugeordnet.");
    expect(screen.getByTestId("studio-assumptions")).toHaveTextContent("Zeitrahmen 4h");
    expect(screen.getByTestId("studio-rules")).toHaveTextContent("Bereit zum Prüfen");
    expect(screen.getByTestId("studio-rules")).toHaveTextContent("Stop");
  });

  it("an unclear and vague text shows what was NOT read and asks instead of guessing; an answer chip completes the rules", async () => {
    renderStudio();
    await screen.findByTestId("studio-view");
    type(EXAMPLES.find((e) => e.id === "vague")!.text);
    understand();
    const unclear = await screen.findByTestId("studio-unclear");
    expect(within(unclear).getAllByTestId("studio-unclear-item").length).toBeGreaterThan(0);
    expect(unclear).toHaveTextContent("engem");
    const q = screen.getByTestId("studio-questions");
    const ask = within(q).getByTestId("studio-ask-op:long");
    expect(ask).toHaveAttribute("data-state", "open");
    const before = screen.getByTestId("studio-rules").textContent;
    fireEvent.click(within(ask).getByTestId("studio-answer-op:long-or-first"));
    await waitFor(() => expect(screen.getByTestId("studio-ask-op:long")).toHaveAttribute("data-state", "answered"));
    expect(screen.getByTestId("studio-rules").textContent).not.toBe(before);
    expect(useStudio.getState().editor.answers["op:long"]).toBe("or-first");
  });

  it("a missing direction is a NEEDED question: the backtest says so until a chip answers it", async () => {
    renderStudio();
    await screen.findByTestId("studio-view");
    type("Wenn der RSI unter 30 fällt, Stop 2 ATR, Ziel 2R");
    understand();
    const ask = await screen.findByTestId("studio-ask-side");
    expect(ask).toHaveAttribute("data-state", "needed");
    expect(screen.getByTestId("studio-rules")).toHaveTextContent("Noch nicht bereit");
    expect(screen.getByTestId("studio-run-hint")).toHaveTextContent("Offene Frage");
    fireEvent.click(within(ask).getByTestId("studio-answer-side-long"));
    await waitFor(() => expect(screen.getByTestId("studio-rules")).toHaveTextContent("Bereit zum Prüfen"));
    expect(screen.queryByTestId("studio-run-hint")).toBeNull();
  });

  it("editing the text after Verstehen marks the reading as stale and never re-reads it silently", async () => {
    renderStudio();
    await screen.findByTestId("studio-view");
    type(RSI_TEXT);
    understand();
    await screen.findByTestId("studio-understood");
    type(`${RSI_TEXT}, nicht am Freitag`);
    expect(screen.getByTestId("studio-stale")).toBeInTheDocument();
    expect(screen.getByTestId("studio-understanding")).toHaveAttribute("data-stale", "true");
    understand();
    await waitFor(() => expect(screen.queryByTestId("studio-stale")).toBeNull());
    expect(screen.getByTestId("studio-understood")).toHaveTextContent("Freitag");
  });

  it("Backtest: real candles, the figures, the sample warning, the split, and both closing sentences", async () => {
    renderStudio();
    await screen.findByTestId("studio-view");
    type(RSI_TEXT);
    understand();
    await screen.findByTestId("studio-understood");
    await act(async () => {
      fireEvent.click(screen.getByTestId("studio-run"));
    });
    const res = await screen.findByTestId("studio-result", {}, { timeout: 60_000 });
    const n = Number(res.getAttribute("data-n"));
    expect(n).toBeGreaterThan(0);
    expect(within(res).getByTestId("studio-kpi-trades")).toHaveTextContent(String(n));
    for (const label of ["Trefferquote", "Ø R", "Profit-Faktor", "Max. Drawdown"]) expect(within(res).getByTestId("studio-kpis")).toHaveTextContent(label);
    expect(within(res).getByTestId("studio-sample")).toHaveAttribute("data-level", n < 30 ? "small" : "ok");
    expect(within(res).getByTestId("studio-split")).toBeInTheDocument();
    expect(within(res).getByTestId("studio-stand")).toHaveTextContent("BTCUSDT · 4h · 1 Jahr");
    const card = screen.getByTestId("studio-backtest");
    expect(card).toHaveTextContent("Ein Backtest zeigt die Vergangenheit, keine Prognose.");
    expect(card).toHaveTextContent("Keine professionelle Finanzberatung.");
    // the figures are the lab's own: the same engine, so a second run gives the same number of trades
    const first = n;
    await act(async () => {
      fireEvent.click(screen.getByTestId("studio-run"));
    });
    await waitFor(() => expect(screen.getByTestId("studio-backtest")).toHaveAttribute("data-status", "done"), { timeout: 60_000 });
    expect(Number(screen.getByTestId("studio-result").getAttribute("data-n"))).toBe(first);
  }, 120_000);

  it("Als Entwurf speichern: v1, then v2 only for a real change; the working copy is kept; versions can be restored and compared", async () => {
    renderStudio();
    await screen.findByTestId("studio-view");
    type(RSI_TEXT);
    fireEvent.change(screen.getByTestId("studio-name"), { target: { value: "RSI-Dip" } });
    await act(async () => {
      fireEvent.click(screen.getByTestId("studio-save"));
    });
    await waitFor(() => expect(stored()).toHaveLength(1));
    expect(stored()[0]).toMatchObject({ name: "RSI-Dip", text: RSI_TEXT });
    expect(stored()[0]!.versions.map((v) => v.n)).toEqual([1]);
    expect(await screen.findByTestId("studio-version-1")).toBeInTheDocument();
    // nothing changed → no second version
    await act(async () => {
      fireEvent.click(screen.getByTestId("studio-save"));
    });
    expect(stored()[0]!.versions).toHaveLength(1);
    // a real change → v2, and the diff says what is different
    type(RSI_TEXT.replace("unter 45", "unter 35"));
    await act(async () => {
      fireEvent.click(screen.getByTestId("studio-save"));
    });
    await waitFor(() => expect(stored()[0]!.versions.map((v) => v.n)).toEqual([1, 2]));
    expect(stored()[0]!.versions[0]!.text).toBe(RSI_TEXT);
    const diff = await screen.findByTestId("studio-vcmp-diff");
    expect(diff).toHaveTextContent("45 → 35");
    // v1 comes back into the editor
    fireEvent.click(screen.getByTestId("studio-restore-1"));
    expect((screen.getByTestId("studio-text") as HTMLTextAreaElement).value).toBe(RSI_TEXT);
    // a note
    fireEvent.change(screen.getByTestId("studio-note-2"), { target: { value: "strenger" } });
    fireEvent.blur(screen.getByTestId("studio-note-2"));
    await waitFor(() => expect(stored()[0]!.versions[1]!.note).toBe("strenger"));
  });

  it("the working copy of a saved strategy is written back by itself (a draft with no version yet)", async () => {
    renderStudio();
    await screen.findByTestId("studio-view");
    type(RSI_TEXT);
    await act(async () => {
      await flushStudio();
    });
    expect(stored()).toHaveLength(1);
    expect(stored()[0]!.versions).toHaveLength(0);
    expect(stored()[0]!.text).toBe(RSI_TEXT);
    expect(screen.getByTestId(`studio-item-${stored()[0]!.id}`)).toHaveTextContent("Entwurf, noch keine Version");
  });

  it("several strategies side by side: each opens in the editor with its own versions", async () => {
    const a = await seed("Eins", RSI_TEXT);
    const b = await seed("Zwei", RSI_TEXT_2);
    renderStudio();
    await screen.findByTestId(`studio-item-${a}`);
    await waitFor(() => expect(useStudio.getState().editor.id).not.toBeNull());
    await act(async () => {
      fireEvent.click(screen.getByTestId(`studio-open-${a}`));
    });
    await waitFor(() => expect((screen.getByTestId("studio-text") as HTMLTextAreaElement).value).toBe(RSI_TEXT));
    await act(async () => {
      fireEvent.click(screen.getByTestId(`studio-open-${b}`));
    });
    await waitFor(() => expect((screen.getByTestId("studio-text") as HTMLTextAreaElement).value).toBe(RSI_TEXT_2));
    expect(screen.getByTestId(`studio-item-${b}`)).toHaveAttribute("data-open", "true");
    expect(screen.getByTestId("studio-version-1")).toBeInTheDocument();
  });

  it("Alle testen: the same candles for everyone, the number compared on screen before and after, rank, test window and the multiple-testing note", async () => {
    const a = await seed("Eins", RSI_TEXT);
    const b = await seed("Zwei", RSI_TEXT_2);
    const c = await seed("Drei", RSI_TEXT_3);
    renderStudio();
    await screen.findByTestId(`studio-item-${a}`);
    expect(screen.getByTestId("studio-compare-run")).toBeDisabled();
    for (const id of [a, b, c]) fireEvent.click(screen.getByTestId(`studio-pick-${id}`));
    expect(screen.getByTestId("studio-picked")).toHaveTextContent("3 Strategien ausgewählt");
    // before the run: the count and the warning already stand there
    expect(screen.getByTestId("studio-cmp-n")).toHaveTextContent("3");
    expect(screen.getByTestId("studio-cmp-before")).toHaveTextContent("3 Strategien auf denselben Daten verglichen");
    await act(async () => {
      fireEvent.click(screen.getByTestId("studio-compare-run"));
    });
    const res = await screen.findByTestId("studio-cmp-result", {}, { timeout: 90_000 });
    expect(screen.getByTestId("studio-cmp-n")).toHaveTextContent("3");
    const table = within(res).getByTestId("studio-cmp-table");
    const rows = within(table).getAllByTestId(/^studio-cmp-row-/);
    expect(rows).toHaveLength(3);
    const ranks = rows.map((r) => r.getAttribute("data-rank")).filter(Boolean).map(Number);
    expect(ranks.sort((x, y) => x - y)).toEqual(ranks.map((_, i) => i + 1));
    expect(ranks.length).toBeGreaterThan(0);
    expect(table).toHaveTextContent("Test-Fenster");
    expect(within(res).getByTestId("studio-cmp-multiple")).toHaveTextContent("Verglichene Strategien: 3");
    expect(within(res).getByTestId("studio-cmp-multiple")).toHaveTextContent(/Bonferroni/);
    expect(within(res).getByTestId("studio-cmp-window")).toHaveTextContent("Train/Test-Schnitt");
    expect(screen.getByTestId("studio-compare")).toHaveTextContent("Keine professionelle Finanzberatung.");
    // a later run counts what was tried before
    expect(useStudio.getState().tried).toHaveLength(3);
  }, 150_000);

  it("a strategy that cannot run yet is listed as not compared, with the reason – it never goes into the table", async () => {
    const a = await seed("Eins", RSI_TEXT);
    const b = await seed("Zwei", RSI_TEXT_2);
    const open = await seed("Offen", "Wenn der RSI unter 30 fällt");
    renderStudio();
    await screen.findByTestId(`studio-item-${a}`);
    for (const id of [a, b, open]) fireEvent.click(screen.getByTestId(`studio-pick-${id}`));
    await act(async () => {
      fireEvent.click(screen.getByTestId("studio-compare-run"));
    });
    await screen.findByTestId("studio-cmp-result", {}, { timeout: 90_000 });
    expect(screen.getByTestId("studio-cmp-n")).toHaveTextContent("2");
    expect(screen.getByTestId("studio-cmp-skipped")).toHaveTextContent("Offen");
    expect(screen.getByTestId("studio-cmp-skipped")).toHaveTextContent("Offene Frage");
    expect(within(screen.getByTestId("studio-cmp-table")).getAllByTestId(/^studio-cmp-row-/)).toHaveLength(2);
  }, 150_000);

  it("Alle ausgewählten live testen: one paper account each (draft source, version frozen), asked first – no order anywhere", async () => {
    const a = await seed("Eins", RSI_TEXT);
    const b = await seed("Zwei", RSI_TEXT_2);
    renderStudio();
    await screen.findByTestId(`studio-item-${a}`);
    for (const id of [a, b]) fireEvent.click(screen.getByTestId(`studio-pick-${id}`));
    fireEvent.click(screen.getByTestId("studio-live-all-start"));
    expect(screen.getByTestId("studio-live-all-confirm")).toHaveTextContent("Kein Echtgeld, keine Order.");
    expect(forwardOfSettings(useJournal.getState().settings).accounts).toHaveLength(0);
    await act(async () => {
      fireEvent.click(screen.getByTestId("studio-live-all-yes"));
    });
    await waitFor(() => expect(forwardOfSettings(useJournal.getState().settings).accounts).toHaveLength(2));
    const accounts = forwardOfSettings(useJournal.getState().settings).accounts;
    expect(accounts.map((x) => x.source.kind)).toEqual(["draft", "draft"]);
    expect(accounts.map((x) => x.source.versionNo)).toEqual([1, 1]);
    expect(accounts.every((x) => x.status === "running")).toBe(true);
    await waitFor(() => expect(stored().every((s) => s.live.length === 1)).toBe(true));
  });

  it("Live testen for the open strategy needs the saved version; the confirm text repeats that nothing is traded", async () => {
    renderStudio();
    await screen.findByTestId("studio-view");
    type(RSI_TEXT);
    understand();
    await screen.findByTestId("studio-live");
    expect(screen.getByTestId("studio-live-start")).toBeDisabled();
    expect(screen.getByTestId("studio-live")).toHaveTextContent("Speichere die Strategie zuerst");
    await act(async () => {
      fireEvent.click(screen.getByTestId("studio-save"));
    });
    await waitFor(() => expect(screen.getByTestId("studio-live-start")).toBeEnabled());
    fireEvent.click(screen.getByTestId("studio-live-start"));
    expect(screen.getByTestId("studio-live-confirm")).toHaveTextContent("Es sendet keine Order und handelt kein Geld.");
    await act(async () => {
      fireEvent.click(screen.getByTestId("studio-live-yes"));
    });
    await waitFor(() => expect(forwardOfSettings(useJournal.getState().settings).accounts).toHaveLength(1));
    expect(forwardOfSettings(useJournal.getState().settings).accounts[0]!.source).toMatchObject({ kind: "draft", versionNo: 1 });
    await waitFor(() => expect(screen.getAllByTestId("studio-live-account")).toHaveLength(1));
  });

  it("a proposal from a slot panel changes nothing until it is confirmed – and then says that the text no longer describes the rules", async () => {
    renderStudio();
    await screen.findByTestId("studio-view");
    type(RSI_TEXT);
    understand();
    await screen.findByTestId("studio-more");
    const cfg: CustomConfig = sanitizeCustom({ ...defaultCustom(), name: "x", interval: "4h", sides: "long", long: newGroup("g1", "and", [{ ...newLeaf("n1", "rsi", "exec"), params: sanitizeParams("rsi", { ...defaultParams("rsi"), mode: "below", level: 25 }) } as Leaf]) });
    const before = JSON.stringify(useStudio.getState().parsed!.rules);
    act(() => useStudio.getState().propose({ config: cfg, note: "RSI-Schwelle 25 statt 45." }));
    const box = await screen.findByTestId("studio-proposal");
    expect(box).toHaveTextContent("RSI-Schwelle 25 statt 45.");
    expect(box).toHaveTextContent("Ein Vorschlag ändert nichts, bevor du ihn übernimmst.");
    expect(JSON.stringify(useStudio.getState().parsed!.rules)).toBe(before);
    fireEvent.click(screen.getByTestId("studio-proposal-dismiss"));
    expect(screen.queryByTestId("studio-proposal")).toBeNull();
    expect(JSON.stringify(useStudio.getState().parsed!.rules)).toBe(before);
    act(() => useStudio.getState().propose({ config: cfg, note: "RSI-Schwelle 25 statt 45." }));
    fireEvent.click(await screen.findByTestId("studio-proposal-apply"));
    expect(JSON.stringify(useStudio.getState().parsed!.rules)).not.toBe(before);
    expect(screen.getByTestId("studio-override")).toHaveTextContent("Der Text beschreibt die Regeln jetzt nicht mehr genau.");
    fireEvent.click(within(screen.getByTestId("studio-override")).getByText("Zurück zum Text"));
    expect(screen.queryByTestId("studio-override")).toBeNull();
    expect(JSON.stringify(useStudio.getState().parsed!.rules)).toBe(before);
  });

  it("the example chips fill the text and read it at once; the vague one asks, the clean ones do not", async () => {
    renderStudio();
    await screen.findByTestId("studio-view");
    for (const ex of EXAMPLES) {
      fireEvent.click(screen.getByTestId(`studio-example-${ex.id}`));
      expect((screen.getByTestId("studio-text") as HTMLTextAreaElement).value).toBe(ex.text);
      const p = useStudio.getState().parsed!;
      if (ex.id === "vague") expect(p.unclear.length + p.asks.length).toBeGreaterThan(0);
      else {
        expect(p.unclear, ex.id).toHaveLength(0);
        expect(p.ready, ex.id).toBe(true);
      }
    }
  });
});
