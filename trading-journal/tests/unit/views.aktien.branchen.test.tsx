/**
 * The Branchen-Trend section in jsdom, on the whole chain: the cards ← the client (`@/market/industry`) ← the Netlify function (run for real)
 * ← a mocked Ken-French library that serves a ZIP in its own layout. The Ampel, sort and search, the paper protocol (what is written, how it
 * is exported, that nothing is "gesendet"), the check of a lab run's result file (the shipped REAL example says VERWORFEN, and the page says it),
 * the Pine card with its honest sentence, and the reasons shown when the data cannot be had.
 */
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { readFileSync } from "node:fs";
import { gunzipSync } from "node:zlib";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { SupabaseClient } from "@supabase/supabase-js";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { ApiError, FUNCTIONS_MISSING } from "@/cloud/api";
import { INDUSTRY_NAMES, fmtDay } from "@/domain/industryTrend";
import { memoryKV } from "@/market/cache";
import { createIndustryData } from "@/market/industry/client";
import { storageKey } from "@/store/storage";
import { setIndustryForTests } from "../../netlify/functions/_lib/industry/load";
import { resetGuardForTests } from "../../netlify/functions/_lib/stocks/guard";
import { setSupabaseAdminForTests } from "../../netlify/functions/_lib/supabase";
import industryDaily from "../../netlify/functions/industry-daily.mts";
import { reply, zipOf } from "./congress.harness";

const saved = vi.hoisted(() => ({ files: [] as { name: string; data: string; mime: string }[] }));
vi.mock("@/store/download", () => ({
  download: vi.fn(async (name: string, data: string, mime: string) => {
    saved.files.push({ name, data, mime });
    return true;
  }),
  canDownload: () => true,
}));

const { default: BranchenCard } = await import("@/views/aktien/branchen/BranchenCard");
const { MotionRoot } = await import("@/motion/MotionRoot");
const { resetBranchenForTests, setBranchenDepsForTests, useBranchen } = await import("@/views/aktien/branchen/store");

const here = dirname(fileURLToPath(import.meta.url));
const EXAMPLE = readFileSync(join(here, "../../public/branchen-trend/beispiel-megatest.json"), "utf8");

/* ------------------------------------------------------------------ the world: a library with 48 industries */

const NAMES = Object.keys(INDUSTRY_NAMES);
const DAYS = 5200;
const CRASH = DAYS - 50;
const dayOf = (k: number): string => {
  const y = 1990 + Math.floor(k / 360);
  const m = 1 + Math.floor((k % 360) / 30);
  const d = 1 + (k % 30);
  return `${y}${String(m).padStart(2, "0")}${String(d).padStart(2, "0")}`;
};
const LAST_DAY = dayOf(DAYS - 1);
/** industry i: i % 3 = 0 rises all the time (green), 1 falls all the time (red, never in), 2 rises and crashes 50 days before the end (red, left the market) */
const cell = (i: number, k: number): string => {
  if (i % 3 === 1) return "-0.30";
  if (i % 3 === 2 && k >= CRASH) return "-0.80";
  return k % 2 ? "0.40" : "0.60";
};
function csv(): string {
  const out = ["This file was created using the 202609 CRSP database.", "", "  Average Value Weighted Returns -- Daily", `,${NAMES.join(",")}`];
  for (let k = 0; k < DAYS; k++) out.push(`${dayOf(k)},${NAMES.map((_, i) => cell(i, k).padStart(7)).join(",")}`);
  out.push("", "Copyright 2026 Eugene F. Fama and Kenneth R. French");
  return out.join("\n");
}
const GREEN = NAMES.filter((_, i) => i % 3 === 0);
const EXITED = NAMES.filter((_, i) => i % 3 === 2);

const ctx = { ip: "203.0.113.9" } as Parameters<typeof industryDaily>[1];
const world = { calls: 0, apiDown: null as null | "missing" | "upstream" };
const gunzip = async (b: Uint8Array): Promise<Uint8Array> => new Uint8Array(gunzipSync(b));
async function api(path: string): Promise<unknown> {
  world.calls++;
  if (world.apiDown === "missing") throw new ApiError(0, "functions_missing", FUNCTIONS_MISSING);
  const res = await industryDaily(new Request(`https://x.test/api/v1${path}`), ctx);
  const body = (await res.json()) as { error?: { code: string; message: string } };
  if (!res.ok) throw new ApiError(res.status, body.error!.code, body.error!.message);
  return body;
}

/** The clock of the Ampel's entries and the data client the card asks. */
function arm(opts: { kv?: ReturnType<typeof memoryKV> } = {}): void {
  const fetchMock = vi.fn(async () => (world.apiDown === "upstream" ? reply("down", 503) : reply(zipOf(csv(), "48_Industry_Portfolios_Daily.csv"), 200, { "content-type": "application/zip" })));
  setIndustryForTests({ fetch: fetchMock as unknown as typeof fetch });
  const client = createIndustryData({ api: api as never, kv: opts.kv ?? memoryKV(), gunzip, online: () => true });
  setBranchenDepsForTests({ data: () => client, now: () => new Date(2026, 9, 31, 8, 15, 30) });
}

beforeAll(() => {
  if (typeof globalThis.ResizeObserver === "undefined") {
    globalThis.ResizeObserver = class {
      observe() {}
      unobserve() {}
      disconnect() {}
    } as unknown as typeof ResizeObserver;
  }
});

beforeEach(() => {
  localStorage.clear();
  saved.files = [];
  world.calls = 0;
  world.apiDown = null;
  setSupabaseAdminForTests({ rpc: vi.fn(async () => ({ data: 1, error: null })), auth: { getClaims: vi.fn(async () => ({ data: null, error: { message: "none" } })) } } as unknown as SupabaseClient);
  resetGuardForTests();
  resetBranchenForTests();
  arm();
});
afterEach(() => {
  cleanup();
  resetBranchenForTests();
  setBranchenDepsForTests(null);
  setIndustryForTests(null);
  setSupabaseAdminForTests(null);
  vi.restoreAllMocks();
});

const wrap = () =>
  render(
    <MotionRoot>
      <BranchenCard />
    </MotionRoot>,
  );
const ready = async (): Promise<void> => {
  await waitFor(() => expect(screen.getByTestId("branchen-ampel-body")).toHaveAttribute("data-state", "ready"), { timeout: 20_000 });
};
const tiles = (): HTMLElement[] => screen.queryAllByTestId("branchen-tile");
const codes = (): string[] => tiles().map((t) => t.getAttribute("data-code")!);

/* ------------------------------------------------------------------ the Ampel */

describe("Branchen-Trend – die Ampel", () => {
  it("lädt von selbst, zeigt 48 Kacheln und den Stand der Daten – mit „kein Echtzeit“", async () => {
    wrap();
    // before the data: placeholders of the same size, no tile yet, and the words say what happens
    expect(screen.getByTestId("branchen-grid-loading").children).toHaveLength(48);
    expect(screen.getByTestId("branchen-status")).toHaveTextContent("Branchendaten werden geladen");
    await ready();
    expect(tiles()).toHaveLength(48);
    expect(screen.queryByTestId("branchen-grid-loading")).toBeNull();
    const stand = screen.getByTestId("branchen-stand");
    expect(stand).toHaveTextContent("Quelle: Ken French Data Library (Dartmouth)");
    expect(stand).toHaveTextContent(`Daten bis ${fmtDay(LAST_DAY)}`);
    expect(stand).toHaveTextContent("Datenbank 202609");
    expect(stand).toHaveTextContent("monatlich aktualisiert, kein Echtzeit");
    // the page is honest about what it is
    const honest = screen.getByTestId("branchen-honest");
    expect(honest).toHaveTextContent("Rückblick, keine Prognose");
    expect(honest).toHaveTextContent("Nur US-Branchen");
    expect(honest).toHaveTextContent("Es wird nichts an eine Börse oder einen Broker gesendet");
    expect(screen.getByTestId("branchen-rule")).toHaveTextContent("Oberer Kanal 20 Tage · unterer Kanal und Stop 40 Tage · Keltner-Faktor 2,8 · Ziel-Volatilität 2 %");
  });

  it("grün = Kaufsignal, rot = Cash – jede Kachel sagt es in Worten und nennt Datum und Gewicht", async () => {
    wrap();
    await ready();
    expect(screen.getByTestId("branchen-count-kauf")).toHaveTextContent(`${GREEN.length} von 48`);
    expect(screen.getByTestId("branchen-count-cash")).toHaveTextContent(String(48 - GREEN.length));
    const green = tiles().filter((t) => t.getAttribute("data-state") === "kauf");
    expect(green.map((t) => t.getAttribute("data-code")).sort()).toEqual([...GREEN].sort());
    const agric = tiles().find((t) => t.getAttribute("data-code") === "Agric")!;
    expect(agric).toHaveTextContent("Landwirtschaft");
    expect(agric).toHaveTextContent("Kauf");
    expect(within(agric).getByTestId("branchen-tile-weight")).toHaveTextContent(/Zielgewicht \d/);
    expect(within(agric).getByTestId("branchen-tile-since")).toHaveTextContent(/^seit \d\d\.\d\d\.\d{4} \(\d+ Handelstage\)$/);
    // a red tile that never was in: said so; one that left: the day it left
    const never = tiles().find((t) => t.getAttribute("data-code") === NAMES[1])!;
    expect(never).toHaveTextContent("Cash");
    expect(within(never).getByTestId("branchen-tile-weight")).toHaveTextContent("kein Gewicht");
    expect(within(never).getByTestId("branchen-tile-since")).toHaveTextContent("seit Beginn der Daten");
    const left = tiles().find((t) => t.getAttribute("data-code") === EXITED[0])!;
    expect(left.getAttribute("data-state")).toBe("cash");
    expect(within(left).getByTestId("branchen-tile-since")).toHaveTextContent(/^seit \d\d\.\d\d\.\d{4} \(\d+ Handelstage?\)$/);
  });

  it("die Summe der Zielgewichte steht da, mit der Angabe, ob der Hebel gekürzt hat", async () => {
    wrap();
    await ready();
    expect(screen.getByTestId("branchen-gross")).toHaveTextContent(/\d+ %/);
    expect(screen.getByTestId("branchen-gross")).toHaveTextContent(/ohne Kürzung|auf den Hebel von 2 gekürzt/);
  });

  it("Suche nach Name oder Kürzel (ohne Beachtung von Umlauten), keine Treffer sagt es", async () => {
    wrap();
    await ready();
    fireEvent.change(screen.getByTestId("branchen-search"), { target: { value: "landwirt" } });
    await waitFor(() => expect(codes()).toEqual(["Agric"]));
    fireEvent.change(screen.getByTestId("branchen-search"), { target: { value: "RUESTUNG" } });
    await waitFor(() => expect(codes()).toEqual(["Guns"]));
    fireEvent.change(screen.getByTestId("branchen-search"), { target: { value: "xyz" } });
    await waitFor(() => expect(screen.getByTestId("branchen-none")).toHaveTextContent("Keine Branche passt"));
  });

  it("Sortieren: Signal (grün zuerst), A–Z, neuester Wechsel; „Nur Kaufsignale“ filtert", async () => {
    wrap();
    await ready();
    // default: green first
    const first = codes().slice(0, GREEN.length);
    expect([...first].sort()).toEqual([...GREEN].sort());
    fireEvent.click(screen.getByRole("radio", { name: "A–Z" }));
    await waitFor(() => expect(codes()[0]).toBe("Autos")); // „Autos und Lkw“ vor „Bau“, „Banken“ …
    const names = tiles().map((t) => within(t).getByText(/./, { selector: "span.line-clamp-2" }).textContent!);
    expect(names).toEqual([...names].sort((a, b) => a.localeCompare(b, "de")));
    fireEvent.click(screen.getByRole("radio", { name: "Neuester Wechsel" }));
    await waitFor(() => {
      const t = tiles().map((x) => within(x).getByTestId("branchen-tile-since").textContent!);
      // never-changed industries come last
      expect(t[t.length - 1]).toBe("seit Beginn der Daten");
    });
    fireEvent.click(screen.getByTestId("branchen-only-buy"));
    await waitFor(() => expect(tiles()).toHaveLength(GREEN.length));
    expect(tiles().every((x) => x.getAttribute("data-state") === "kauf")).toBe(true);
    // the choice is kept on this device
    expect(JSON.parse(localStorage.getItem(storageKey("aktien-branchen"))!)).toMatchObject({ sort: "wechsel", onlyBuy: true });
  });

  it("die Karten sind Listen und die Regler haben Namen (Tastatur, Screenreader)", async () => {
    wrap();
    await ready();
    expect(screen.getByRole("list", { name: "Ampel der 48 Branchen" })).toBeInTheDocument();
    expect(screen.getByLabelText("Branche suchen")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Neu laden" })).toBeEnabled();
  });
});

describe("Branchen-Trend – wenn die Daten fehlen", () => {
  it("ohne Server-Funktion: der Grund in Worten, ein Knopf zum Wiederholen, keine erfundene Ampel – die Auswertung geht trotzdem", async () => {
    world.apiDown = "missing";
    wrap();
    await waitFor(() => expect(screen.getByTestId("branchen-error")).toBeInTheDocument(), { timeout: 20_000 });
    const err = screen.getByTestId("branchen-error");
    expect(err).toHaveAttribute("data-reason", "no-server");
    expect(err).toHaveTextContent("Die Branchendaten konnten nicht geladen werden");
    expect(err).toHaveTextContent("Server-Funktion für die Branchendaten ist auf dieser Seite nicht eingerichtet");
    expect(err).toHaveTextContent("Es wird keine Ampel erfunden");
    expect(tiles()).toHaveLength(0);
    expect(screen.getByTestId("branchen-grid-loading").children).toHaveLength(48);
    // retry works once the server is there
    world.apiDown = null;
    fireEvent.click(screen.getByTestId("branchen-retry"));
    await ready();
    expect(tiles()).toHaveLength(48);
    expect(screen.queryByTestId("branchen-error")).toBeNull();
  });

  it("Bibliothek down, aber eine Kopie auf dem Gerät: die Kopie, ausdrücklich als solche", async () => {
    const kv = memoryKV();
    arm({ kv });
    const first = wrap();
    await ready();
    first.unmount();
    // days later: the copy on the device is older than 12 hours, the page is opened again (a fresh client), and the library is down
    const key = [...(await kv.keys())][0]!;
    const entry = (await kv.get(key)) as { storedAt: number };
    await kv.set(key, { ...entry, storedAt: entry.storedAt - 13 * 3_600_000 });
    resetBranchenForTests();
    arm({ kv });
    world.apiDown = "upstream";
    setIndustryForTests({ fetch: vi.fn(async () => reply("down", 503)) as unknown as typeof fetch });
    wrap();
    await ready();
    const stale = screen.getByTestId("branchen-stale");
    expect(stale).toHaveTextContent("Kopie auf diesem Gerät");
    expect(stale).toHaveAttribute("data-reason", "upstream");
    expect(tiles()).toHaveLength(48);
    expect(screen.getByTestId("branchen-stand")).toHaveTextContent(`Daten bis ${fmtDay(LAST_DAY)}`);
  });
});

/* ------------------------------------------------------------------ the protocol */

describe("Branchen-Trend – das Papier-Protokoll", () => {
  it("schreibt die Wechsel der letzten 60 Handelstage, jede Zeile DEMO/PAPIER und nicht gesendet; ein zweiter Lauf fügt nichts doppelt ein", async () => {
    wrap();
    await ready();
    // the crash 50 days before the end moved every industry of the third kind out of the market
    expect(screen.getByTestId("branchen-log-count")).toHaveTextContent(`${EXITED.length} Einträge`);
    const rows = screen.getAllByTestId("branchen-log-row");
    expect(rows).toHaveLength(8);
    expect(rows[0]).toHaveTextContent("Verkauf");
    expect(rows[0]).toHaveTextContent("DEMO/PAPIER");
    expect(rows[0]).toHaveTextContent("nicht gesendet");
    const stored = JSON.parse(localStorage.getItem(storageKey("aktien-branchen-protokoll"))!) as { gesendet: boolean; strategie: string; erfasst: string; modus: string }[];
    expect(stored).toHaveLength(EXITED.length);
    expect(stored.every((e) => e.gesendet === false && e.modus === "DEMO/PAPIER" && e.strategie === "s-20-40-2.8-0.02-2.0")).toBe(true);
    expect(stored[0]!.erfasst).toBe("2026-10-31T08:15:30");
    // loading again changes nothing
    fireEvent.click(screen.getByTestId("branchen-reload"));
    await waitFor(() => expect(screen.getByTestId("branchen-reload")).toHaveTextContent("Neu laden"));
    await ready();
    expect(screen.getByTestId("branchen-log-count")).toHaveTextContent(`${EXITED.length} Einträge`);
  });

  it("exportiert eine .jsonl im Format der Labor-Datei", async () => {
    wrap();
    await ready();
    fireEvent.click(screen.getByTestId("branchen-log-export"));
    await waitFor(() => expect(saved.files).toHaveLength(1));
    const f = saved.files[0]!;
    expect(f.name).toBe("protokoll.jsonl");
    const lines = f.data.trimEnd().split("\n");
    expect(lines).toHaveLength(EXITED.length);
    expect(lines[0]).toMatch(/^\{"erfasst": "2026-10-31T08:15:30", "datum": "\d{8}", "branche": "[A-Za-z]+", "signal": "VERKAUF", "strategie": "s-20-40-2\.8-0\.02-2\.0", "modus": "DEMO\/PAPIER", "gesendet": false, "hinweis": "Nur Protokoll, keine Order gesendet\."\}$/);
    expect(f.data.endsWith("\n")).toBe(true);
  });

  it("ausgeschaltet schreibt es nichts; leeren fragt nach", async () => {
    localStorage.setItem(storageKey("aktien-branchen"), JSON.stringify({ autoLog: false }));
    resetBranchenForTests();
    wrap();
    await ready();
    expect(screen.getByTestId("branchen-log-count")).toHaveTextContent("0 Einträge");
    expect(screen.getByTestId("branchen-log-empty")).toHaveTextContent("das automatische Eintragen ist aus");
    // switching it on takes over what the Ampel on screen shows
    fireEvent.click(screen.getByTestId("branchen-autolog"));
    await waitFor(() => expect(screen.getByTestId("branchen-log-count")).toHaveTextContent(`${EXITED.length} Einträge`));
    fireEvent.click(screen.getByTestId("branchen-log-clear"));
    expect(screen.getByText("Wirklich alle Einträge löschen?")).toBeInTheDocument();
    expect(useBranchen.getState().protocol).toHaveLength(EXITED.length);
    fireEvent.click(screen.getByTestId("branchen-log-clear-yes"));
    await waitFor(() => expect(screen.getByTestId("branchen-log-count")).toHaveTextContent("0 Einträge"));
  });

  it("liest eine Protokoll-Datei ein: gültige Zeilen kommen dazu, kaputte und „gesendet: true“ nicht", async () => {
    localStorage.setItem(storageKey("aktien-branchen"), JSON.stringify({ autoLog: false }));
    resetBranchenForTests();
    wrap();
    await ready();
    const good = '{"erfasst": "2026-10-30T23:38:56", "datum": "20260713", "branche": "Books", "signal": "KAUF", "strategie": "s-65-20-1.0-0.01-2.0", "modus": "DEMO/PAPIER", "gesendet": false, "hinweis": "Nur Protokoll, keine Order gesendet."}';
    const sent = good.replace('"gesendet": false', '"gesendet": true');
    const file = new File([`${good}\nkaputt\n${sent}\n`], "protokoll.jsonl", { type: "application/x-ndjson" });
    fireEvent.change(screen.getByTestId("branchen-log-file"), { target: { files: [file] } });
    await waitFor(() => expect(screen.getByTestId("branchen-log-note")).toHaveTextContent("1 neue Zeile übernommen, 2 übersprungen"));
    expect(screen.getByTestId("branchen-log-count")).toHaveTextContent("1 Eintrag");
  });

  it("sagt offen, dass das Virtuelle Konto nicht angebunden ist", async () => {
    wrap();
    const f = screen.getByTestId("branchen-forward");
    expect(f).toHaveTextContent("Virtuelles Konto");
    expect(f).toHaveTextContent("Offen:");
    expect(f).toHaveTextContent("lassen sich dort nicht als Papier-Position führen");
  });
});

/* ------------------------------------------------------------------ the result of a lab run */

async function loadExample(): Promise<void> {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string) => {
      expect(url).toMatch(/branchen-trend\/beispiel-megatest\.json$/);
      return new Response(EXAMPLE, { status: 200, headers: { "content-type": "application/json" } });
    }),
  );
  fireEvent.click(screen.getByTestId("branchen-example"));
  await waitFor(() => expect(screen.getByTestId("branchen-result")).toBeInTheDocument());
}

describe("Branchen-Trend – Ergebnis eines Laufs", () => {
  it("sagt vorab, dass der Lauf außerhalb des Browsers gerechnet wird, und bietet den Befehl an – mit dem Hinweis auf die Faktor-Daten", () => {
    wrap();
    const lead = screen.getByTestId("branchen-ergebnis-lead");
    expect(lead).toHaveTextContent("außerhalb des Browsers");
    expect(lead).toHaveTextContent("rund 12.000 Varianten");
    expect(lead).toHaveTextContent("etwa 20 Minuten");
    expect(screen.getByTestId("branchen-command-text")).toHaveTextContent("python3 megatest.py --industry 48_Industry_Portfolios_daily_CSV.zip --factors F-F_Research_Data_Factors_daily_CSV.zip --lab-dir lab");
    expect(screen.getByTestId("branchen-command")).toHaveTextContent("Faktor-Daten sind nötig");
  });

  it("kopiert den Befehl", async () => {
    const writeText = vi.fn(async () => undefined);
    Object.defineProperty(navigator, "clipboard", { value: { writeText }, configurable: true });
    wrap();
    fireEvent.click(screen.getByTestId("branchen-command-copy"));
    await waitFor(() => expect(writeText).toHaveBeenCalledWith(expect.stringContaining("megatest.py --industry")));
  });

  it("das Beispiel (ein echter Lauf) sagt VERWORFEN: Basis bleibt, die Prüfungen als ✓/✗ – ohne „Gewinner“", async () => {
    wrap();
    await loadExample();
    const v = screen.getByTestId("branchen-verdict");
    expect(v).toHaveAttribute("data-state", "verworfen");
    expect(screen.getByTestId("branchen-verdict-word")).toHaveTextContent("VERWORFEN");
    expect(screen.getByTestId("branchen-verdict-lead")).toHaveTextContent("Die Basis bleibt (20/40 · Keltner 2,8 · Ziel-Vola 2 % · Hebel 2)");
    expect(screen.getByTestId("branchen-verdict-lead")).toHaveTextContent("die Kandidatin (65/20 · Keltner 1 · Ziel-Vola 1 % · Hebel 2) wird nicht übernommen");
    expect(screen.getByTestId("branchen-verdict-failed")).toHaveTextContent("Endtest (letzte 20 %): Sharpe Kandidatin >= Basis");
    expect(screen.getByTestId("branchen-verdict-failed")).toHaveTextContent("Kosten: Endtest-Rendite nach 10 bp über Markt");
    expect(screen.queryByTestId("branchen-verdict-inconsistent")).toBeNull();
    const checks = screen.getAllByTestId("branchen-check");
    expect(checks).toHaveLength(5);
    expect(checks.map((c) => c.getAttribute("data-ok"))).toEqual(["true", "false", "true", "false", "true"]);
    expect(checks[1]).toHaveTextContent("✗");
    expect(checks[1]).toHaveTextContent("nicht bestanden");
    expect(checks[1]).toHaveTextContent("0.39 gegen 0.54");
    expect(checks[0]).toHaveTextContent("✓");
    expect(checks[0]).toHaveTextContent("Deflated Sharpe >= 0,95 (12096 Varianten)");
    expect(screen.getByTestId("branchen-rank")).toHaveTextContent("-0,00");
    const text = screen.getByTestId("branchen-result").textContent!;
    expect(text).not.toMatch(/Gewinner|Sieger|beste Strategie|übernommen\b.*produktiv/i);
  });

  it("Kennzahlen: Basis und Kandidatin je Zeitraum, getrennt nach Entwicklung, Validierung, Endtest und gesamt", async () => {
    wrap();
    await loadExample();
    const kz = screen.getByTestId("branchen-kennzahlen");
    for (const id of ["entw", "valid", "endtest", "gesamt"]) expect(within(kz).getByTestId(`branchen-kz-${id}`)).toBeInTheDocument();
    const end = within(kz).getByTestId("branchen-kz-endtest");
    // base 0.54 against candidate 0.39 in the end test; CAGR 13.3 % against 6.5 %
    expect(end).toHaveTextContent("Sharpe 0,54");
    expect(end).toHaveTextContent("Sharpe 0,39");
    expect(end).toHaveTextContent("CAGR 13,3 %");
    expect(end).toHaveTextContent("CAGR 6,5 %");
    expect(end).toHaveTextContent("Max. Rückgang 60,2 %");
    expect(within(kz).getByTestId("branchen-kz-entw")).toHaveTextContent("01.07.1926 – 03.12.1984");
    expect(within(kz).getByTestId("branchen-kz-market")).toHaveTextContent("Markt (Endtest): Sharpe 0,57");
  });

  it("die Diagramme: Streudiagramm mit ehrlicher Zahl, Histogramm, Fächer mit „10.000 simulierten Pfaden“ in der Überschrift", async () => {
    wrap();
    await loadExample();
    expect(screen.getByTestId("branchen-scatter-note")).toHaveTextContent(/700 von 12\.096 Varianten \(Stichprobe\)/);
    expect(screen.getByTestId("branchen-scatter-note")).toHaveTextContent(/unter der Linie sind im Endtest schlechter .*: \d+ %/);
    expect(screen.getByRole("img", { name: /Streudiagramm: Sharpe-Verhältnis jeder von 700 gezeigten Varianten/ })).toBeInTheDocument();
    expect(screen.getByRole("img", { name: /Histogramm der Sharpe-Verhältnisse/ })).toBeInTheDocument();
    expect(screen.getByTestId("branchen-fan-title")).toHaveTextContent("10.000 simulierte Pfade, 5 Jahre");
    expect(screen.getByTestId("branchen-fan")).toHaveTextContent("der verworfenen Kandidatin");
    expect(screen.getByRole("img", { name: /Fächerdiagramm von 10\.000 simulierten Vermögenspfaden/ })).toBeInTheDocument();
    const stats = screen.getByTestId("branchen-fan-stats");
    expect(stats).toHaveTextContent("Median nach 5 Jahren");
    expect(stats).toHaveTextContent("3,9 %"); // Verlustchance 0.0389
    expect(screen.getByTestId("branchen-fan")).toHaveTextContent("kein Test und keine Prognose");
  });

  it("das Fadenkreuz des Fächers geht auch mit der Tastatur und wird vorgelesen", async () => {
    wrap();
    await loadExample();
    const canvas = screen.getByTestId("branchen-fan-canvas");
    expect(canvas).toHaveAttribute("tabindex", "0");
    canvas.focus();
    fireEvent.keyDown(canvas, { key: "ArrowRight" });
    await waitFor(() => expect(screen.getByTestId("branchen-fan-live")).toHaveTextContent(/^0,0 J: P05 .*×, Median .*×, P95 .*×$/));
    fireEvent.keyDown(canvas, { key: "Escape" });
    await waitFor(() => expect(screen.getByTestId("branchen-fan-live")).toHaveTextContent(/^$/));
  });

  it("die besten Varianten der Auswahl und ihr Endtest (unter der Basis rot markiert, auch als Text)", async () => {
    wrap();
    await loadExample();
    const rows = screen.getAllByTestId("branchen-top-row");
    expect(rows).toHaveLength(10);
    expect(rows[0]).toHaveTextContent("65/20 · Keltner 1 · Ziel-Vola 1 % · Hebel 2");
    expect(rows[0]).toHaveTextContent("unter der Basis");
    expect(screen.getByTestId("branchen-top")).toHaveTextContent("Anteil aller Varianten, die im Endtest besser als die Basis sind: 64 %");
  });

  it("eine Datei wählen: nur lokal gelesen, geprüft; Unsinn nennt die erste fehlerhafte Stelle", async () => {
    wrap();
    const pick = (text: string, name = "megatest.json", size?: number): void => {
      const f = new File([text], name, { type: "application/json" });
      if (size) Object.defineProperty(f, "size", { value: size });
      fireEvent.change(screen.getByTestId("branchen-file"), { target: { files: [f] } });
    };
    pick("kein json");
    await waitFor(() => expect(screen.getByTestId("branchen-result-error")).toHaveTextContent("keine gültige JSON-Datei"));
    pick('{"entscheidung":"VERWORFEN"}');
    await waitFor(() => expect(screen.getByTestId("branchen-result-error")).toHaveTextContent("kein Ergebnis eines Labor-Laufs"));
    pick("{}", "gross.json", 5 * 1024 * 1024);
    await waitFor(() => expect(screen.getByTestId("branchen-result-error")).toHaveTextContent("größer als 4 MB"));
    expect(screen.queryByTestId("branchen-result")).toBeNull();
    // a good file replaces the message
    pick(EXAMPLE, "mein-lauf.json");
    await waitFor(() => expect(screen.getByTestId("branchen-result")).toHaveAttribute("data-name", "mein-lauf.json"));
    expect(screen.queryByTestId("branchen-result-error")).toBeNull();
    // and can be removed again
    fireEvent.click(screen.getByTestId("branchen-clear"));
    expect(screen.queryByTestId("branchen-result")).toBeNull();
  });

  it("ein Ergebnis, das ÜBERNOMMEN sagt, schaltet nichts um und ist kein Versprechen", async () => {
    wrap();
    const o = JSON.parse(EXAMPLE) as { checks: { ok: boolean }[]; entscheidung: string };
    o.checks.forEach((c) => (c.ok = true));
    o.entscheidung = "UEBERNOMMEN";
    act(() => {
      useBranchen.getState().loadResultText(JSON.stringify(o), "ok.json");
    });
    const v = screen.getByTestId("branchen-verdict");
    expect(v).toHaveAttribute("data-state", "uebernommen");
    expect(screen.getByTestId("branchen-verdict-word")).toHaveTextContent("ÜBERNOMMEN");
    expect(screen.getByTestId("branchen-verdict-lead")).toHaveTextContent("kein Versprechen für die Zukunft");
    expect(screen.getByTestId("branchen-verdict-lead")).toHaveTextContent("Die App schaltet nichts um");
  });

  it("widerspricht das Wort der Datei ihren Prüfungen, gelten die Prüfungen – und es wird gesagt", async () => {
    wrap();
    const o = JSON.parse(EXAMPLE) as { entscheidung: string };
    o.entscheidung = "UEBERNOMMEN"; // two checks still failed
    act(() => {
      useBranchen.getState().loadResultText(JSON.stringify(o), "falsch.json");
    });
    expect(screen.getByTestId("branchen-verdict")).toHaveAttribute("data-state", "verworfen");
    expect(screen.getByTestId("branchen-verdict-inconsistent")).toHaveTextContent("Die Datei widerspricht sich");
    expect(screen.getByTestId("branchen-verdict-inconsistent")).toHaveTextContent("Es gelten die Prüfungen");
  });

  it("das Beispiel nicht erreichbar (Seite ohne Datei): ein Satz mit Ausweg, kein Absturz", async () => {
    wrap();
    vi.stubGlobal("fetch", vi.fn(async () => new Response("<!doctype html><html></html>", { status: 200 })));
    fireEvent.click(screen.getByTestId("branchen-example"));
    await waitFor(() => expect(screen.getByTestId("branchen-result-error")).toHaveTextContent("Das Beispiel ließ sich nicht laden"));
    expect(screen.getByTestId("branchen-result-error")).toHaveTextContent("Wähle eine eigene megatest.json");
  });
});

/* ------------------------------------------------------------------ Pine */

describe("Branchen-Trend – Pine-Skript", () => {
  it("sagt offen, dass es nicht in TradingView kompiliert wurde; zeigt Text, Hinweise, Nachricht, Schema und den Weg zu n8n", async () => {
    wrap();
    const p = screen.getByTestId("branchen-pine");
    expect(screen.getByTestId("branchen-pine-honest")).toHaveTextContent("nicht in TradingView kompiliert");
    expect(within(p).getByRole("heading", { name: "Pine-Skript für TradingView" })).toBeInTheDocument();
    fireEvent.click(screen.getByTestId("branchen-pine-toggle"));
    const code = (await screen.findByTestId("branchen-pine-code")) as HTMLTextAreaElement;
    expect(code.value.startsWith("//@version=5\n")).toBe(true);
    expect(code.value).toContain("indicator(");
    expect(code.value).toContain("alertcondition(buySig");
    expect(code).toHaveAttribute("readonly");
    expect(screen.getByTestId("branchen-pine-notes")).toHaveTextContent("Nicht in TradingView kompiliert");
    expect(screen.getByTestId("branchen-payload-example")).toHaveTextContent('"strategie":"s-20-40-2.8-0.02-2.0"');
    expect(screen.getByTestId("branchen-schema")).toHaveTextContent('"title": "Branchen-Trend Signal"');
    const hook = screen.getByTestId("branchen-webhook");
    expect(hook).toHaveTextContent("bewusst keinen Empfänger");
    expect(hook).toHaveTextContent("n8n");
    expect(hook).toHaveTextContent("deine Freigabe");
  });

  it("speichert die Datei mit dem Namen der Variante", async () => {
    wrap();
    fireEvent.click(screen.getByTestId("branchen-pine-save"));
    await waitFor(() => expect(saved.files).toHaveLength(1));
    expect(saved.files[0]!.name).toBe("Branchen-Trend_s-20-40-2.8-0.02-2.0.pine");
    expect(saved.files[0]!.data.startsWith("//@version=5")).toBe(true);
  });
});
