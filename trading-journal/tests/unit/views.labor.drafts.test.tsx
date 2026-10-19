/**
 * F15 / F13 / F45 views: versions of the saved drafts (a version per saved change, the change in plain language, notes,
 * restore, two versions side by side) and the playbook exchange (export text, strict import with named reasons, preview,
 * the imported draft stays marked "fremd", "Probe im Labor" runs it on the market history).
 */
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { readFileSync } from "node:fs";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { defaultParams, sanitizeParams } from "@/domain/lab/rules/blocks";
import { defaultCustom, newGroup, newLeaf, sanitizeCustom } from "@/domain/lab/rules/tree";
import type { CustomConfig, Leaf, LeafParams } from "@/domain/lab/rules/types";
import { MAX_PLAYBOOK_BYTES, playbookText } from "@/domain/playbook";
import type { BinanceRest } from "@/market/sources/binance";
import { MorphDialogProvider } from "@/motion/MorphDialog";
import { MotionRoot } from "@/motion/MotionRoot";
import { __resetLabor, __setHistoryDeps, useLabor } from "@/views/labor";
import DraftsSection from "@/views/labor/DraftsSection";
import { useVersions } from "@/views/labor/versionsStore";
import { bootFixtureJournal, installDomPolyfills } from "./views.overview.harness";

type Row = [number, number, number, number, number];
const read = (n: string): Row[] => (JSON.parse(readFileSync(`tests/unit/fixtures/${n}`, "utf8")) as { bars: Row[] }).bars;
const H4_ROWS = read("binance-btcusdt-4h.json");
const D1_ROWS = read("binance-btcusdt-1d.json");
const NOW = H4_ROWS[H4_ROWS.length - 1]![0] * 1000 + 14_400_000 + 60_000;

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

const leaf = (id: string, block: Leaf["block"], params: LeafParams = {}): Leaf => ({ ...newLeaf(id, block, "exec"), params: sanitizeParams(block, { ...defaultParams(block), ...params }) });
const idea = (level = 50, name = "Mein Entwurf"): CustomConfig => sanitizeCustom({ ...defaultCustom(), name, interval: "4h", sides: "long", long: newGroup("g1", "and", [leaf("n1", "rsi", { mode: "below", level })]) });

const renderDrafts = () =>
  render(
    <MotionRoot>
      <MorphDialogProvider>
        <DraftsSection />
      </MorphDialogProvider>
    </MotionRoot>,
  );

beforeAll(() => {
  installDomPolyfills();
  HTMLCanvasElement.prototype.getContext = (() => null) as unknown as typeof HTMLCanvasElement.prototype.getContext;
  window.scrollTo = vi.fn() as never;
});

beforeEach(async () => {
  await bootFixtureJournal();
  localStorage.clear();
  __resetLabor();
  vi.useFakeTimers({ toFake: ["Date"], now: NOW });
  __setHistoryDeps({ rest: () => fixtureRest(), proxy: () => null, store: () => null, now: () => NOW });
});
afterEach(() => {
  __resetLabor();
  __setHistoryDeps(null);
  vi.useRealTimers();
});

const saveAs = (level: number, name = "Mein Entwurf"): string => {
  useLabor.getState().setCfg({ strategy: "custom", custom: idea(level, name) });
  return useLabor.getState().saveDraft(name)!;
};

describe("Versionen der Entwürfe", () => {
  it("ohne Entwurf: ehrlicher Leerzustand", () => {
    renderDrafts();
    expect(screen.getByTestId("labor-versions-empty")).toHaveTextContent("Noch kein gespeicherter Entwurf");
  });

  it("jede gespeicherte Änderung ist eine Version, die Änderung steht in Klartext; ohne Änderung entsteht keine", async () => {
    const id = saveAs(50);
    saveAs(50);
    expect(useVersions.getState().map[id]).toHaveLength(1);
    saveAs(40);
    renderDrafts();
    const items = await screen.findAllByTestId("labor-version");
    expect(items).toHaveLength(2);
    // newest first, marked as current, with its diff
    expect(items[0]).toHaveAttribute("data-n", "2");
    expect(within(items[0]!).getByText("aktuell")).toBeInTheDocument();
    expect(within(items[0]!).getByTestId("labor-version-diff")).toHaveTextContent("Long · RSI Niveau: 50 → 40");
    expect(within(items[1]!).getByText("Erste gespeicherte Fassung.")).toBeInTheDocument();
    // restore is for older versions only
    expect(within(items[0]!).getByTestId("labor-version-restore")).toBeDisabled();
  });

  it("Wiederherstellen setzt die Regeln zurück und zählt als neue Version mit Hinweis", async () => {
    const id = saveAs(50);
    saveAs(40);
    renderDrafts();
    const items = await screen.findAllByTestId("labor-version");
    await act(async () => {
      fireEvent.click(within(items[1]!).getByTestId("labor-version-restore"));
    });
    const list = useVersions.getState().map[id]!;
    expect(list.map((v) => v.n)).toEqual([1, 2, 3]);
    expect(list[2]!.note).toBe("Wiederhergestellt aus Version 1");
    const d = useLabor.getState().drafts.find((x) => x.id === id)!;
    expect(d.config.long.children[0]).toMatchObject({ params: { level: 50 } });
    expect(useLabor.getState().cfg.custom.long.children[0]).toMatchObject({ params: { level: 50 } });
    await waitFor(() => expect(screen.getAllByTestId("labor-version")).toHaveLength(3));
  });

  it("eine Notiz lässt sich nachtragen, auch beim Speichern aus dem Editor", async () => {
    const id = saveAs(50);
    renderDrafts();
    const note = await screen.findByTestId("version-note");
    fireEvent.change(note, { target: { value: "Start" } });
    fireEvent.blur(note);
    expect(useVersions.getState().map[id]![0]!.note).toBe("Start");
    // a changed editor idea saved as a new version of the draft, with a note
    useLabor.getState().setCfg({ custom: idea(35) });
    fireEvent.change(screen.getByTestId("labor-versions-savenote"), { target: { value: "Schwelle gesenkt" } });
    await act(async () => {
      fireEvent.click(screen.getByTestId("labor-versions-save"));
    });
    const list = useVersions.getState().map[id]!;
    expect(list).toHaveLength(2);
    expect(list[1]!.note).toBe("Schwelle gesenkt");
    // unchanged → no version
    await act(async () => {
      fireEvent.click(screen.getByTestId("labor-versions-save"));
    });
    expect(useVersions.getState().map[id]).toHaveLength(2);
  });

  it("zwei Versionen nebeneinander: geänderte Zeilen markiert, Kennzahlen nur wenn ein Lauf existiert", async () => {
    saveAs(50);
    saveAs(40);
    renderDrafts();
    const table = await screen.findByTestId("labor-compare-rows");
    const changed = [...table.querySelectorAll('tbody tr[data-changed="true"]')];
    expect(changed).toHaveLength(1);
    expect(changed[0]).toHaveTextContent("Long-Regeln");
    expect(changed[0]).toHaveTextContent("RSI(14) unter 50");
    expect(changed[0]).toHaveTextContent("RSI(14) unter 40");
    const runs = screen.getAllByTestId("labor-compare-run");
    expect(runs).toHaveLength(2);
    for (const r of runs) expect(r).toHaveTextContent("Kein Lauf dieser Version im Labor");
  });
});

describe("Playbook austauschen", () => {
  it("Export: der Text ist ein versioniertes Playbook mit Titel, Beschreibung und Autor", async () => {
    renderDrafts();
    fireEvent.change(await screen.findByTestId("playbook-title"), { target: { value: "Rücksetzer" } });
    fireEvent.change(screen.getByTestId("playbook-description"), { target: { value: "RSI im Trend" } });
    fireEvent.change(screen.getByTestId("playbook-author"), { target: { value: "Mia" } });
    const pb = JSON.parse((screen.getByTestId("playbook-text") as HTMLTextAreaElement).value) as Record<string, unknown>;
    expect(pb).toMatchObject({ format: "tj-playbook", version: 1, title: "Rücksetzer", description: "RSI im Trend", author: "Mia" });
    expect(pb).not.toHaveProperty("symbol");
    fireEvent.click(screen.getByTestId("playbook-market"));
    expect(JSON.parse((screen.getByTestId("playbook-text") as HTMLTextAreaElement).value)).toMatchObject({ symbol: "BTCUSDT" });
  });

  it("Import: Fehler werden mit Grund genannt, unbekannte Bausteine beim Namen; es entsteht nichts", async () => {
    renderDrafts();
    const input = await screen.findByTestId("playbook-input");
    const bad = JSON.parse(playbookText(idea())) as { idea: { long: { children: unknown[] } } };
    bad.idea.long.children.push({ type: "leaf", id: "n9", block: "quantumOscillator", tf: "exec", params: {} });
    fireEvent.change(input, { target: { value: JSON.stringify(bad) } });
    fireEvent.click(screen.getByTestId("playbook-check"));
    const errors = screen.getByTestId("playbook-errors");
    expect(errors).toHaveTextContent("„quantumOscillator“");
    expect(errors).toHaveTextContent("blockiert");
    expect(screen.queryByTestId("playbook-preview")).toBeNull();
    expect(useLabor.getState().drafts).toHaveLength(0);
    fireEvent.change(input, { target: { value: "{ nope" } });
    fireEvent.click(screen.getByTestId("playbook-check"));
    expect(screen.getByTestId("playbook-errors")).toHaveTextContent("kein gültiges JSON");
  });

  it("Import: eine zu große Datei wird abgelehnt, bevor sie gelesen wird", async () => {
    renderDrafts();
    const file = new File(["x".repeat(MAX_PLAYBOOK_BYTES + 10)], "gross.json", { type: "application/json" });
    await act(async () => {
      fireEvent.change(await screen.findByTestId("playbook-file"), { target: { files: [file] } });
    });
    expect(screen.getByTestId("playbook-file-error")).toHaveTextContent("zu groß");
    expect(screen.queryByTestId("playbook-preview")).toBeNull();
  });

  it("Import: Vorschau → als fremder Entwurf anlegen → Probe im Labor läuft auf der Historie", async () => {
    renderDrafts();
    const text = playbookText(idea(48, "x"), { title: "Fremde Idee", description: "Aus dem Netz", author: "Jemand" });
    fireEvent.change(await screen.findByTestId("playbook-input"), { target: { value: text } });
    fireEvent.click(screen.getByTestId("playbook-check"));
    const preview = screen.getByTestId("playbook-preview");
    expect(within(preview).getByTestId("playbook-preview-title")).toHaveTextContent("Fremde Idee");
    expect(preview).toHaveTextContent("fremdes Playbook");
    expect(preview).toHaveTextContent("von Jemand (Angabe aus der Datei, nicht geprüft)");
    expect(within(preview).getByTestId("playbook-preview-rules")).toHaveTextContent("Long wenn RSI(14) unter 48");
    // nothing exists before the click
    expect(useLabor.getState().drafts).toHaveLength(0);
    expect(within(preview).queryByTestId("playbook-probe")).toBeNull();

    await act(async () => {
      fireEvent.click(within(preview).getByTestId("playbook-create"));
    });
    const d = useLabor.getState().drafts[0]!;
    expect(d.name).toBe("Fremde Idee");
    expect(d.origin).toMatchObject({ kind: "playbook", title: "Fremde Idee", author: "Jemand" });
    expect(useVersions.getState().map[d.id]![0]!.note).toBe("Importiertes Playbook");

    await act(async () => {
      fireEvent.click(await screen.findByTestId("playbook-probe"));
    });
    await waitFor(() => expect(useLabor.getState().status).toBe("done"), { timeout: 45_000 });
    expect(useLabor.getState().cfg.strategy).toBe("custom");
    expect(useLabor.getState().result?.name).toBe("Fremde Idee");
    // the foreign marker stays on the draft, also after a re-read from storage
    expect(JSON.parse(localStorage.getItem(Object.keys(localStorage).find((k) => k.endsWith("labor-drafts"))!)!).items[0].origin.kind).toBe("playbook");
  });
});
