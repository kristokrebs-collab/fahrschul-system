/**
 * The optimiser inside the Labor: the section loads the candles with the lab's own loader and runs; what happens on "save" and
 * "challenger" (a new version of a draft / a new draft / a forward account – and never an overwrite of rules that changed since).
 */
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { readFileSync } from "node:fs";
import { beforeAll, beforeEach, afterEach, describe, expect, it, vi } from "vitest";
import { customKey } from "@/domain/lab";
import { forwardOfSettings } from "@/domain/forward";
import { evolveCfgOf } from "@/domain/evolve";
import type { BinanceRest } from "@/market/sources/binance";
import { MorphDialogProvider } from "@/motion/MorphDialog";
import { MotionRoot } from "@/motion/MotionRoot";
import { useJournal } from "@/store/journalStore";
import { DEFAULT_SIGNAL_CFG } from "@/domain/signals";
import { __resetEvolve } from "@/views/evolve/evolveStore";
import { EvolveSection } from "@/views/evolve/EvolveSection";
import { draftEntryId, EDITOR_ID, saveProposalAsVersion, startProposalAsChallenger } from "@/views/evolve/labHost";
import type { StrategyEntry } from "@/views/evolve/types";
import { __resetLabor, __setHistoryDeps, useLabor } from "@/views/labor";
import { __resetForwardRuntime } from "@/views/labor/forward/forwardStore";
import { useVersions } from "@/views/labor/versionsStore";
import { bootFixtureJournal, installDomPolyfills } from "./views.overview.harness";
import { baseRules, ENGINE, realProposals, weakRules } from "./evolve.helpers";

type Row = [number, number, number, number, number];
const read = (n: string): Row[] => (JSON.parse(readFileSync(`tests/unit/fixtures/${n}`, "utf8")) as { bars: Row[] }).bars;
const H4_ROWS = read("binance-btcusdt-4h.json");
const D1_ROWS = read("binance-btcusdt-1d.json");
const NOW = H4_ROWS.at(-1)![0] * 1000 + 14_400_000 + 60_000;

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

const entryOf = (id: string, name: string): StrategyEntry => ({ id, name, config: weakRules(), symbol: "TESTUSDT", signal: DEFAULT_SIGNAL_CFG, engine: ENGINE });

beforeAll(() => {
  installDomPolyfills();
  HTMLCanvasElement.prototype.getContext = (() => null) as unknown as typeof HTMLCanvasElement.prototype.getContext;
  window.scrollTo = vi.fn() as never;
});

beforeEach(async () => {
  await bootFixtureJournal();
  localStorage.clear();
  __resetLabor();
  __resetEvolve();
  __resetForwardRuntime();
  __setHistoryDeps({ rest: () => fixtureRest(), proxy: () => null, store: () => null, now: () => NOW });
});
afterEach(() => {
  __resetLabor();
  __resetEvolve();
  __resetForwardRuntime();
  __setHistoryDeps(null);
});

describe("Optimierer im Labor", { timeout: 90_000 }, () => {
  it("lädt die Kerzen mit dem Lader des Labors und läuft bis zu einem Ergebnis; Editor und Entwürfe bleiben unberührt", async () => {
    vi.useFakeTimers({ toFake: ["Date"], now: NOW });
    try {
      useLabor.getState().setCfg({ strategy: "custom", period: "6m", funding: "none", symbol: "BTCUSDT", custom: baseRules() });
      const before = customKey(useLabor.getState().cfg.custom);
      render(
        <MotionRoot>
          <MorphDialogProvider>
            <EvolveSection />
          </MorphDialogProvider>
        </MotionRoot>,
      );
      const rows = screen.getAllByTestId("evolve-strategy");
      expect(rows).toHaveLength(1);
      expect(rows[0]).toHaveTextContent("Test-Idee (Editor)");
      expect(rows[0]).toHaveTextContent("Kerzen noch nicht geladen");
      fireEvent.click(screen.getByTestId("evolve-start"));
      await waitFor(() => expect(screen.getByTestId("evolve-panel")).not.toHaveAttribute("data-status", "idle"), { timeout: 30_000 });
      await waitFor(() => expect(screen.getByTestId("evolve-panel")).toHaveAttribute("data-status", "done"), { timeout: 60_000 });
      expect(screen.getByTestId("evolve-trials")).toHaveTextContent(/Versuch \d+ von 400/);
      expect(customKey(useLabor.getState().cfg.custom)).toBe(before);
      expect(useLabor.getState().drafts).toHaveLength(0);
      expect(forwardOfSettings(useJournal.getState().settings).accounts).toHaveLength(0);
    } finally {
      vi.useRealTimers();
    }
  });

  it("die Entwürfe des Labors stehen zur Wahl, fremde Entwürfe mit Marke", () => {
    useLabor.getState().setCfg({ strategy: "custom", custom: baseRules() });
    useLabor.getState().saveDraft("Mein Entwurf");
    useLabor.getState().addForeignDraft("Fremd", weakRules(), { kind: "playbook", title: "Fremd", author: null, importedAt: 1, key: "x" });
    render(
      <MotionRoot>
        <MorphDialogProvider>
          <EvolveSection />
        </MorphDialogProvider>
      </MotionRoot>,
    );
    const rows = screen.getAllByTestId("evolve-strategy");
    expect(rows.map((r) => r.getAttribute("data-id"))).toEqual([EDITOR_ID, ...useLabor.getState().drafts.map((d) => draftEntryId(d.id))]); // neueste zuerst, wie in der Entwurfsliste
    expect(rows[1]).toHaveTextContent("fremd");
  });
});

describe("Speichern und Herausfordern im Labor", { timeout: 60_000 }, () => {
  const proposals = realProposals(1);
  const p = proposals[0]!;

  it("Editor-Idee: ein NEUER Entwurf „… v2“ mit erster Version und Notiz; der Editor bleibt, wie er war", () => {
    useLabor.getState().setCfg({ strategy: "custom", custom: weakRules() });
    const before = customKey(useLabor.getState().cfg.custom);
    const res = saveProposalAsVersion(entryOf(EDITOR_ID, "Schwach (Editor)"), p);
    expect(res).toEqual({ ok: true, label: "neuer Entwurf „Schwach v2“" });
    const lab = useLabor.getState();
    expect(lab.drafts.map((d) => d.name)).toEqual(["Schwach v2"]);
    expect(customKey(lab.drafts[0]!.config)).toBe(customKey(p.config));
    expect(customKey(lab.cfg.custom)).toBe(before); // der Editor ist unverändert
    const v = useVersions.getState().map[lab.drafts[0]!.id]!;
    expect(v).toHaveLength(1);
    expect(v[0]!.note).toMatch(/^Vorschlag des Optimierers vom /);
  });

  it("Entwurf: eine neue Version; die alte bleibt in der Liste und lässt sich wiederherstellen", () => {
    useLabor.getState().setCfg({ strategy: "custom", custom: weakRules() });
    const draftId = useLabor.getState().saveDraft("Schwach")!;
    const v1 = useVersions.getState().map[draftId]!.at(-1)!;
    const res = saveProposalAsVersion(entryOf(draftEntryId(draftId), "Schwach"), p);
    expect(res).toEqual({ ok: true, label: "Version 2 von „Schwach“" });
    const list = useVersions.getState().map[draftId]!;
    expect(list.map((v) => v.n)).toEqual([1, 2]);
    expect(list[0]!.key).toBe(v1.key);
    expect(customKey(list[1]!.config)).toBe(customKey(p.config));
    expect(customKey(useLabor.getState().drafts.find((d) => d.id === draftId)!.config)).toBe(customKey(p.config));
  });

  it("haben sich die Regeln des Entwurfs seit dem Vorschlag geändert, wird NICHTS überschrieben", () => {
    useLabor.getState().setCfg({ strategy: "custom", custom: baseRules() }); // andere Regeln als die, für die p gemacht wurde
    const draftId = useLabor.getState().saveDraft("Anders")!;
    const before = customKey(useLabor.getState().drafts.find((d) => d.id === draftId)!.config);
    const res = saveProposalAsVersion(entryOf(draftEntryId(draftId), "Anders"), p);
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.reason).toMatch(/seit dem Vorschlag geändert – es wird nichts überschrieben/);
    expect(customKey(useLabor.getState().drafts.find((d) => d.id === draftId)!.config)).toBe(before);
    expect(useVersions.getState().map[draftId]).toHaveLength(1);
    // ein gelöschter Entwurf
    expect(saveProposalAsVersion(entryOf(draftEntryId("d999"), "Weg"), p)).toEqual({ ok: false, reason: "Den Entwurf gibt es nicht mehr." });
  });

  it("Herausforderer: ein virtuelles Konto mit den Regeln des Vorschlags, Kosten und Risiko des Labors – kein Eingriff in die Strategie", async () => {
    useLabor.getState().setCfg({ strategy: "custom", custom: weakRules(), capital: 5_000, riskPct: 0.5, maxLeverage: 3 });
    const res = await startProposalAsChallenger(entryOf(EDITOR_ID, "Schwach"), p, 1_700_000_000_000);
    expect(res.ok).toBe(true);
    const accounts = forwardOfSettings(useJournal.getState().settings).accounts;
    expect(accounts).toHaveLength(1);
    const a = accounts[0]!;
    expect(res.ok && res.id).toBe(a.id);
    expect(a.name).toBe("Herausforderer · Schwach");
    expect(a.key).toBe(customKey(p.config));
    expect(a.capital).toBe(5_000);
    expect(a.riskPct).toBe(0.5);
    expect(a.status).toBe("running");
    expect(a.cursor.t).toBeNull(); // nichts rückwirkend
    expect(useLabor.getState().drafts).toHaveLength(0);
    expect(evolveCfgOf(useJournal.getState().settings.evolve).proposals).toEqual([]); // das Entscheiden schreibt die Karte, nicht der Host
  });
});
