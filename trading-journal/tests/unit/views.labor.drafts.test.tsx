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
import { useJournal } from "@/store/journalStore";
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

describe("Playbook · Fassungen, Checkliste und Journal (F45)", () => {
  const ID = "pb-k3x9q2m7ab";
  const fileOf = (level: number, rev: number, extra: Record<string, unknown> = {}): string => playbookText(idea(level, "x"), { title: "Fremde Idee", author: "Mia", id: ID, rev, ...extra });
  const read = async (text: string) => {
    fireEvent.change(await screen.findByTestId("playbook-input"), { target: { value: text } });
    fireEvent.click(screen.getByTestId("playbook-check"));
    return screen.getByTestId("playbook-preview");
  };
  const pickDraft = (name: string): void => {
    fireEvent.click(screen.getByTestId("playbook-pick"));
    fireEvent.click(screen.getByRole("option", { name }));
  };
  const exportText = (): Record<string, unknown> => JSON.parse((screen.getByTestId("playbook-text") as HTMLTextAreaElement).value) as Record<string, unknown>;

  it("Export eines eigenen Entwurfs: Kennung und Fassung 1; erst Kopieren merkt sich den Export; geänderte Regeln geben Fassung 2, gleiche Regeln dieselbe Nummer", async () => {
    const write = vi.fn(async () => undefined);
    Object.defineProperty(navigator, "clipboard", { value: { writeText: write }, configurable: true });
    const id = saveAs(40, "Meine Idee");
    renderDrafts();
    await screen.findByTestId("playbook-title");
    // Editor-Stand: einmalig, ohne Fassungsnummer
    expect(screen.getByTestId("playbook-rev")).toHaveTextContent("Ohne Fassungsnummer");
    expect(exportText()).not.toHaveProperty("rev");
    pickDraft("Meine Idee");
    expect(screen.getByTestId("playbook-rev")).toHaveTextContent("Erster Export dieses Entwurfs: Fassung 1");
    const first = exportText();
    expect(first).toMatchObject({ rev: 1 });
    expect(String(first.id)).toMatch(/^pb-[a-z0-9]{10}$/);
    // Vorschau allein ändert nichts
    expect(useLabor.getState().drafts.find((d) => d.id === id)!.exported).toBeUndefined();
    fireEvent.change(screen.getByTestId("playbook-checklist"), { target: { value: "News geprüft\n\nSpread normal" } });
    expect(exportText().checklist).toEqual(["News geprüft", "Spread normal"]);
    await act(async () => {
      fireEvent.click(screen.getByTestId("playbook-copy"));
    });
    await waitFor(() => expect(write).toHaveBeenCalledTimes(1));
    const exported = useLabor.getState().drafts.find((d) => d.id === id)!.exported!;
    expect(exported).toMatchObject({ id: first.id, rev: 1 });
    // die Regeln bleiben: dieselbe Nummer
    expect(screen.getByTestId("playbook-rev")).toHaveTextContent("als Fassung 1 weitergegeben");
    expect(exportText()).toMatchObject({ id: first.id, rev: 1 });
    // die Regeln ändern sich: dieselbe Kennung, Fassung 2, mit Notiz
    act(() => {
      useLabor.getState().replaceDraftConfig(id, idea(33, "Meine Idee"));
    });
    expect(screen.getByTestId("playbook-rev")).toHaveTextContent("seit Fassung 1 geändert: Diese Datei wird Fassung 2");
    fireEvent.change(screen.getByTestId("playbook-changes"), { target: { value: "tieferes Niveau" } });
    expect(exportText()).toMatchObject({ id: first.id, rev: 2, changes: "tieferes Niveau" });
  });

  it("ein fremder Entwurf bekommt keine eigene Fassungsnummer", async () => {
    renderDrafts();
    const preview = await read(fileOf(48, 1));
    await act(async () => {
      fireEvent.click(within(preview).getByTestId("playbook-create"));
    });
    pickDraft("Fremde Idee");
    expect(screen.getByTestId("playbook-rev")).toHaveTextContent("stammt aus einem fremden Playbook");
    expect(exportText()).not.toHaveProperty("rev");
  });

  it("Import: eine Datei mit Fassung und Checkliste zeigt Fassung, Notiz und Checkliste; als Entwurf angelegt merkt sich der Entwurf Kennung und Fassung", async () => {
    renderDrafts();
    const preview = await read(fileOf(48, 1, { checklist: ["News geprüft", "Spread normal"], changes: "erste Fassung" }));
    expect(preview).toHaveTextContent("Fassung 1");
    expect(within(preview).getByTestId("playbook-preview-changes")).toHaveTextContent("Neu in dieser Fassung: erste Fassung");
    const list = within(preview).getByTestId("playbook-preview-checklist");
    expect(list).toHaveTextContent("Checkliste des Autors (2)");
    expect(list).toHaveTextContent("News geprüft");
    expect(list).toHaveTextContent("Prüfpunkte von Hand – das Labor rechnet sie nicht.");
    expect(within(preview).queryByTestId("playbook-update")).toBeNull();
    await act(async () => {
      fireEvent.click(within(preview).getByTestId("playbook-create"));
    });
    expect(useLabor.getState().drafts[0]!.origin).toMatchObject({ kind: "playbook", pid: ID, rev: 1, changes: "erste Fassung", checklist: ["News geprüft", "Spread normal"] });
  });

  it("dieselbe Datei in Fassung 2: erkannt als neuere Fassung des Entwurfs, mit dem Unterschied in Klartext; nichts passiert vor dem Klick", async () => {
    renderDrafts();
    let preview = await read(fileOf(48, 1));
    await act(async () => {
      fireEvent.click(within(preview).getByTestId("playbook-create"));
    });
    const d = useLabor.getState().drafts[0]!;
    const before = JSON.stringify(d.config);

    preview = await read(fileOf(35, 2, { changes: "tieferes RSI-Niveau" }));
    const update = within(preview).getByTestId("playbook-update");
    expect(update).toHaveAttribute("data-relation", "newer");
    expect(update).toHaveTextContent("Neuere Fassung eines Playbooks, das du schon hast: Dein Entwurf „Fremde Idee“ hat Fassung 1, diese Datei Fassung 2.");
    expect(within(update).getByTestId("playbook-update-diff")).toHaveTextContent("Long · RSI Niveau: 48 → 35");
    expect(within(update).queryByTestId("playbook-update-local")).toBeNull();
    expect(update).toHaveTextContent("Die App abonniert nichts");
    // vor dem Klick bleibt alles, wie es war – auch die Regeln und die Versionen
    expect(JSON.stringify(useLabor.getState().drafts[0]!.config)).toBe(before);
    expect(useVersions.getState().map[d.id]).toHaveLength(1);
    // „als eigenen Entwurf“ bleibt möglich, aber nachrangig
    expect(within(preview).getByTestId("playbook-create")).toHaveTextContent("Als eigenen neuen Entwurf anlegen");

    fireEvent.click(within(update).getByTestId("playbook-update-apply"));
    const now = useLabor.getState().drafts[0]!;
    expect(useLabor.getState().drafts).toHaveLength(1);
    expect(now.name).toBe("Fremde Idee");
    expect(JSON.stringify(now.config)).not.toBe(before);
    expect(now.origin).toMatchObject({ pid: ID, rev: 2, changes: "tieferes RSI-Niveau" });
    // als neue Version mit Notiz, die alte bleibt wiederherstellbar
    const versions = useVersions.getState().map[d.id]!;
    expect(versions).toHaveLength(2);
    expect(versions[1]!.note).toBe("Fassung 2 von Mia: tieferes RSI-Niveau");
    expect(within(screen.getByTestId("playbook-preview")).getByTestId("playbook-update")).toHaveTextContent("Fassung 2 übernommen");
  });

  it("hat der Leser den Entwurf selbst geändert, warnt die Karte; eine ältere Fassung wird nicht zum Übernehmen angeboten", async () => {
    renderDrafts();
    let preview = await read(fileOf(48, 2));
    await act(async () => {
      fireEvent.click(within(preview).getByTestId("playbook-create"));
    });
    const d = useLabor.getState().drafts[0]!;
    act(() => {
      useLabor.getState().replaceDraftConfig(d.id, idea(41, d.name));
    });
    preview = await read(fileOf(35, 3));
    expect(within(preview).getByTestId("playbook-update-local")).toHaveTextContent("Du hast diesen Entwurf seit dem Import selbst geändert.");
    expect(within(preview).getByTestId("playbook-update-diff")).toHaveTextContent("RSI Niveau: 41 → 35");
    preview = await read(fileOf(60, 1));
    const older = within(preview).getByTestId("playbook-update");
    expect(older).toHaveAttribute("data-relation", "older");
    expect(older).toHaveTextContent("ältere Fassung (1) als die deines Entwurfs „Fremde Idee“ (2)");
    expect(within(older).queryByTestId("playbook-update-apply")).toBeNull();
  });

  it("ein anderes Playbook mit anderer Kennung ist keine Fassung: normaler Import", async () => {
    renderDrafts();
    let preview = await read(fileOf(48, 1));
    await act(async () => {
      fireEvent.click(within(preview).getByTestId("playbook-create"));
    });
    preview = await read(playbookText(idea(55, "y"), { title: "Andere Idee", id: "pb-zzzzzzzzzz", rev: 7 }));
    expect(within(preview).queryByTestId("playbook-update")).toBeNull();
    expect(within(preview).getByTestId("playbook-create")).toHaveTextContent("Als fremden Entwurf anlegen");
  });

  it("Ins Journal: eine Entscheidungsgrundlage mit der Checkliste des Autors – erst nach dem Klick, und ohne Trades", async () => {
    renderDrafts();
    const preview = await read(fileOf(48, 2, { checklist: ["News geprüft", "Spread normal"], description: "RSI im Trend" }));
    const trades = useJournal.getState().trades.length;
    expect(useJournal.getState().settings.setups.some((x) => x.name === "Fremde Idee")).toBe(false);
    await act(async () => {
      fireEvent.click(within(preview).getByTestId("playbook-journal"));
    });
    await waitFor(() => expect(useJournal.getState().settings.setups.some((x) => x.name === "Fremde Idee")).toBe(true));
    expect(useJournal.getState().settings.setups.filter((x) => x.name === "Fremde Idee")).toHaveLength(1);
    const s = useJournal.getState().settings.setups.find((x) => x.name === "Fremde Idee")!;
    expect(s.checklist.map((c) => c.text)).toEqual(["News geprüft", "Spread normal"]);
    expect(s.desc).toContain("Aus einem Playbook von Mia (Fassung 2)");
    expect(useJournal.getState().trades).toHaveLength(trades);
  });
});
