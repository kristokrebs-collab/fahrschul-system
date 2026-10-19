// @vitest-environment node
/// <reference types="node" />
/**
 * F29 bug report „Der Screenshot konnte nicht verarbeitet werden – er zeigt direkt 2 Trades“: a Bitunix app screenshot
 * „Vertragsaufträge › Auftragshistorie“ with two CLOSING orders (their opening orders are not in the picture) and one
 * filled OPENING order that belongs to neither.
 *
 * The fake model answer (`tests/fixtures/orderhistory-bitunix-report.json`) is exactly what `report_trades` would
 * deliver for the transcribed cards – raw text as displayed:
 *   (1) BTCUSDT „Long schließen“  Realisierter PnL +7.57604000  Ø 82,701.8  Menge 0.0562  Gebühr 1.16196029  2026-10-19 09:47:27  15X
 *   (2) BTCUSDT „Short schließen“ Realisierter PnL −18.48135000 Ø 82,806.9  Menge 0.0489  Gebühr 1.01231435  2026-10-19 06:46:44  15X
 *   (3) BTCUSDT „Long Öffnen“     Auftragspreis 82,670.0 Menge 0.0133 ausgeführt (unten abgeschnitten)
 *
 * What it must come to: two closed candidates WITHOUT an entry ("Einstieg fehlt im Bild", never invented) with a
 * computable, clearly assumed proposal, plus one open trade – through the whole chain: server (fake Anthropic client) →
 * zod → candidates → rows → checks → edits → draft → the editor's own validation.
 */
import Anthropic from "@anthropic-ai/sdk";
import { afterEach, describe, expect, it } from "vitest";
import type { Trade } from "@/domain/types";
import { buildCandidates, resolveZone, type Candidate } from "@/journal/extract/candidate";
import { checksOf, resolvedPnlMode, type Check } from "@/journal/extract/checks";
import { Extraction, ORDER_HISTORY_PROMPT, SYSTEM_PROMPT, TOOL_NAME, type ExtractedTrade } from "@/journal/extract/contract";
import { findDuplicate } from "@/journal/extract/dedupe";
import { toDraft } from "@/journal/extract/draft";
import { impliedEntries } from "@/journal/extract/implied";
import { normalizeToolInput } from "@/journal/extract/lenient";
import { mergeCandidates } from "@/journal/extract/merge";
import { parseOrderLabel } from "@/journal/extract/orders";
import { applyEdits, attentionRows, editField, rowsOf, type Edit } from "@/journal/extract/rows";
import { parseZone } from "@/journal/extract/time";
import { formFromDraft, toRecord, validateRecord } from "@/overlays/TradeEditor";
import { ExtractBody } from "@/journal/extract/contract";
import { extract, setVisionClientForTests } from "../../netlify/functions/shot-extract.mts";
import report from "../fixtures/orderhistory-bitunix-report.json";
import { settings } from "./domain.fixtures";

const NOW = new Date("2026-10-19T12:00:00Z");
const BERLIN = "Europe/Berlin";
const PNG = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==";

afterEach(() => setVisionClientForTests(null));

/** The model's answer through the server path: tool_use block → lenient pass → zod → sanitize. */
async function serverReply(input: unknown = report) {
  const create = async () => ({ model: "claude-opus-5-5", stop_reason: "tool_use", content: [{ type: "tool_use", id: "t", name: TOOL_NAME, input }] }) as unknown as Anthropic.Beta.BetaMessage;
  setVisionClientForTests({ beta: { messages: { create } } } as unknown as Pick<Anthropic, "beta">);
  return extract(ExtractBody.parse({ images: [{ mediaType: "image/png", data: PNG }] }), "sk-test", "claude-opus-5-5");
}

const build = (zoneId: string | null = null) => {
  const user = zoneId ? parseZone(zoneId) : null;
  return async () => {
    const reply = await serverReply();
    const zone = resolveZone(reply.timezone, user, BERLIN);
    return mergeCandidates(buildCandidates(reply, { now: NOW, zone, localZone: BERLIN, fallbackStyle: "comma" }));
  };
};

const ctx = (trades: Trade[] = []) => ({ trades, now: NOW, currency: "USDT" });
const codes = (c: Candidate, trades: Trade[] = []) => checksOf(c, ctx(trades)).map((k) => k.code);
const checkOf = (c: Candidate, code: string): Check => checksOf(c, ctx()).find((k) => k.code === code)!;

function stored(over: Partial<Trade> = {}): Trade {
  return { id: "t1", account: "scalp", side: "long", status: "closed", date: "2026-10-19T08:00", pair: "BTC/USDT", timeframe: "1h", entry: 82500, stop: null, target: null, exit: 82701.8, size: null, leverage: null, fees: null, pnlManual: null, setups: [], checks: {}, conviction: null, followedPlan: null, emotion: "", reason: "", notes: "", chart: "", pnl: null, r: null, createdAt: "", updatedAt: "", ...over };
}

describe("der Weg durch den Server", () => {
  it("die Karten kommen unverändert als Rohtext an: drei Trades, nichts verworfen, kein Fehler", async () => {
    const reply = await serverReply();
    expect(reply.reason).toBeUndefined();
    expect(reply.trades).toHaveLength(3);
    expect(reply.trades[0]).toMatchObject({ side: "long", status: "closed", entries: [], leverage: "15X", fees: "1.16196029", realizedPnl: "+7.57604000" });
    expect(reply.trades[0]!.exits[0]).toMatchObject({ price: "82,701.8", qty: "0.0562", time: "2026-10-19 09:47:27", label: "Long schließen" });
    expect(reply.trades[1]!.realizedPnl).toBe("−18.48135000"); // the typographic minus survives as text
    expect(reply.trades[2]).toMatchObject({ status: "open", exits: [], unreadable: ["Durchschnittspreis"] });
    expect(reply.trades[2]!.confidence.entries).toBe(0.6);
    // absent fields keep confidence 0 whatever the model said
    expect(reply.trades[0]!.confidence.entries).toBe(0);
    expect(reply.trades[0]!.confidence.stop).toBe(0);
  });

  it("Formatfehler der KI (leere Texte, Konfidenz > 1, Ausführung ohne Preis) werfen nichts weg, sondern werden benannt", async () => {
    const messy = JSON.parse(JSON.stringify(report));
    messy.trades[0].fees = "";
    messy.trades[0].confidence.exits = 1.3;
    messy.trades[1].exits.push({ price: "Markt", qty: "0.0489", time: "", label: "Short schließen" }, { price: "", qty: null, time: null, label: null });
    messy.timezone = " ";
    const reply = await serverReply(messy);
    expect(reply.trades).toHaveLength(3);
    expect(reply.trades[0]).toMatchObject({ fees: null });
    expect(reply.trades[0]!.confidence.exits).toBe(1);
    expect(reply.trades[1]!.exits).toHaveLength(2); // „Markt“ is text and survives until the client finds no number in it
    expect(reply.timezone).toBeNull();
    expect(reply.notes.join(" ")).toMatch(/Ausführung ohne lesbaren Preis wurde ausgelassen/);
    expect(normalizeToolInput("kaputt").input).toBe("kaputt"); // nothing to repair: the strict schema judges
  });

  it("der Systemprompt kennt das Vokabular der Börsen-Auftragshistorien – und verbietet Raten und Rechnen", () => {
    for (const word of ["Long öffnen", "Short öffnen", "Long schließen", "Short schließen", "Open Long", "Close Short", "Realisierter PnL", "Durchschnittspreis", "Auftragspreis", "Ausgeführt", "Gebühr", "Bitunix", "Binance", "Bybit", "OKX", "Markt"]) expect(ORDER_HISTORY_PROMPT).toContain(word);
    expect(SYSTEM_PROMPT).toContain(ORDER_HISTORY_PROMPT);
    // position side vs order direction vs colours
    expect(ORDER_HISTORY_PROMPT).toMatch(/Long oder Short nennt immer die POSITION, nie die Richtung der Order/);
    expect(ORDER_HISTORY_PROMPT).toMatch(/Farbe .* sagt weder etwas über Gewinn oder Verlust/);
    // no guessing, no maths, no borrowed entry
    expect(ORDER_HISTORY_PROMPT).toMatch(/errätst du nicht, rechnest ihn nicht aus Ergebnis und Menge zurück/);
    expect(SYSTEM_PROMPT).toMatch(/Rate nie, rechne nichts aus/);
  });
});

describe("Auftragsnamen", () => {
  it.each([
    ["Long schließen", "close", "long"],
    ["Short schließen", "close", "short"],
    ["Long Öffnen", "open", "long"],
    ["Short öffnen", "open", "short"],
    ["Close Long", "close", "long"],
    ["Close Short", "close", "short"],
    ["Open Long", "open", "long"],
    ["Open short", "open", "short"],
    ["Long Close", "close", "long"],
    ["Sell / Close Long", "close", "long"],
    ["Buy / Open Short", "open", "short"],
    ["Long eröffnen", "open", "long"],
  ])("%s → %s %s", (label, action, side) => expect(parseOrderLabel(label)).toEqual({ action, side }));
  it.each(["Kaufen", "Verkauf", "Buy", "Limit", "Markt", "Long", "Open", "Long öffnen Short schließen", "", null])("%s → nicht entscheidbar (null)", (label) => expect(parseOrderLabel(label)).toBeNull());
});

describe("Kandidaten: 2 Schließungen ohne Einstieg + 1 offener Trade", () => {
  it("drei Entwürfe in Bildreihenfolge, die Schließungen ohne erfundenen Einstieg", async () => {
    const [c1, c2, c3] = await build()();
    expect([c1!.status, c2!.status, c3!.status]).toEqual(["closed", "closed", "open"]);
    expect(c1!.entries).toEqual([]);
    expect(c2!.entries).toEqual([]);
    expect([c1!.pair.value, c2!.pair.value, c3!.pair.value]).toEqual(["BTC/USDT", "BTC/USDT", "BTC/USDT"]);
    // „Long schließen“ ist der Ausstieg einer LONG-Position, „Short schließen“ der einer SHORT-Position
    expect(c1!.side).toMatchObject({ value: "long", state: "ok" });
    expect(c2!.side).toMatchObject({ value: "short", state: "ok" });
    expect(c3!.side.value).toBe("long");
    // numbers in the exchange's style (82,701.8 = point decimals) – exactly as displayed
    expect(c1!.exits[0]).toMatchObject({ price: 82701.8, qty: 0.0562 });
    expect(c2!.exits[0]).toMatchObject({ price: 82806.9, qty: 0.0489 });
    expect(c1!.fees.value).toBe(1.16196029);
    expect(c2!.fees.value).toBe(1.01231435);
    expect(c1!.pnl.value).toBe(7.57604);
    expect(c2!.pnl.value).toBe(-18.48135); // U+2212 minus
    expect(c1!.leverage.value).toBe(15);
    expect(c2!.leverage.value).toBe(15);
    // the open order: filled opening, no closing; the order price stands in for the missing average and says so
    expect(c3!.entries).toHaveLength(1);
    expect(c3!.entries[0]).toMatchObject({ price: 82670, qty: 0.0133, at: null, uncertain: true });
    expect(c3!.exits).toEqual([]);
    expect(c3!.unreadable).toEqual(["Durchschnittspreis"]);
  });

  it("die Eröffnung (3) gehört keiner Schließung: nichts wird zusammengelegt", async () => {
    const cands = await build()();
    expect(cands).toHaveLength(3);
    expect(cands.every((c) => c.merged === 1)).toBe(true);
  });

  it("Zeitzone: nichts im Bild → Annahme „Gerät“, die Zeiten bleiben wie gezeigt; die Wahl rechnet um", async () => {
    const reply = await serverReply();
    expect(reply.timezone).toBeNull();
    const zone = resolveZone(reply.timezone, null, BERLIN);
    expect(zone.source).toBe("journal");
    expect(zone.text).toMatch(/Der Screenshot nennt keine Zeitzone – angenommen: Europe\/Berlin \(deine Zeit\)/);
    const [c1, c2] = await build()();
    expect(c1!.exits[0]!.at).toBe("2026-10-19T09:47:27");
    expect(c2!.exits[0]!.at).toBe("2026-10-19T06:46:44");
    // override: the app shows UTC+8 → Berlin is UTC+2 on 2026-10-19 (summer time ends on the 25th): six hours earlier
    const [u1, u2] = await build("UTC+8")();
    expect(u1!.exits[0]!.at).toBe("2026-10-19T03:47:27");
    expect(u2!.exits[0]!.at).toBe("2026-10-19T00:46:44");
    expect(resolveZone(null, parseZone("UTC+8"), BERLIN)).toMatchObject({ source: "user" });
  });

  it("Vorschau-Zeilen: „Einstieg fehlt im Bild“ ist die eine Pflichtzeile, Menge kommt vom Ausstieg", async () => {
    const [c1, , c3] = await build()();
    const rows = rowsOf(c1!, "USDT");
    const entry = rows.find((r) => r.key === "entry")!;
    expect(entry).toMatchObject({ text: "—", state: "missing", optional: false, editable: true });
    expect(entry.note).toBe("Einstieg fehlt im Bild – die Eröffnungsorder ist nicht zu sehen.");
    expect(rows.find((r) => r.key === "qty")).toMatchObject({ label: "Menge (laut Ausstieg)", text: "0,0562", state: "ok" });
    expect(rows.find((r) => r.key === "exit")).toMatchObject({ text: "82.701,8", state: "ok" });
    expect(rows.find((r) => r.key === "fees")!.text).toBe("1,162"); // shown to 4 decimals, the draft keeps every digit
    expect(rows.find((r) => r.key === "pnl")!.text).toBe("+7,576");
    expect(rows.find((r) => r.key === "leverage")!.text).toBe("15×");
    // only the entry needs a look – the entry time is explained by it
    expect(attentionRows(rows).map((r) => r.key)).toEqual(["entry"]);
    // the open trade: the order price is flagged as unsure, the time is simply not there
    const open = rowsOf(c3!, "USDT");
    expect(open.find((r) => r.key === "entry")).toMatchObject({ text: "82.670", state: "uncertain" });
    expect(attentionRows(open).map((r) => r.key)).toContain("entry");
  });
});

describe("Einstieg aus PnL berechnen (Annahme, nie ungefragt)", () => {
  /*
   * Hand calculation (Long: Einstieg = Ausstieg − PnL ÷ Menge, Short: Einstieg = Ausstieg + PnL ÷ Menge):
   *  (1) Long, ohne Gebühr:  7.57604 ÷ 0.0562 = 134.80498  → 82701.8 − 134.80498 = 82566.99502   (≈ 82566.995)
   *      nach Gebühr: (7.57604 + 1.16196029) ÷ 0.0562 = 8.73800029 ÷ 0.0562 = 155.48042 → 82546.31957 (≈ 82546.32)
   *      Differenz: 1.16196029 USDT = 1.16196029 ÷ 0.0562 = 20.67545 im Preis
   *  (2) Short, ohne Gebühr: −18.48135 ÷ 0.0489 = −377.94172  → 82806.9 − 377.94172 = 82428.95828  (≈ 82428.958)
   *      nach Gebühr: (−18.48135 + 1.01231435) ÷ 0.0489 = −17.46903565 ÷ 0.0489 = −357.24001 → 82449.65999 (≈ 82449.66)
   *      Differenz: 1.01231435 USDT = 1.01231435 ÷ 0.0489 = 20.70172 im Preis
   */
  it("beide Lesarten mit Differenz – von Hand nachgerechnet", async () => {
    const [c1, c2] = await build()();
    const a = impliedEntries(c1!)!;
    expect(a.side).toBe("long");
    expect(a.gross.price).toBeCloseTo(82566.995, 3);
    expect(a.net!.price).toBeCloseTo(82546.32, 2);
    expect(a.diffMoney).toBeCloseTo(1.16196029, 8);
    expect(a.diffPrice).toBeCloseTo(20.67545, 4);
    // the long position bought below the exit: a gain of +7.576 USDT for 0.0562 BTC
    expect((82701.8 - a.gross.price) * 0.0562).toBeCloseTo(7.57604, 3);

    const b = impliedEntries(c2!)!;
    expect(b.side).toBe("short");
    expect(b.gross.price).toBeCloseTo(82428.958, 3);
    expect(b.net!.price).toBeCloseTo(82449.66, 2);
    expect(b.diffMoney).toBeCloseTo(1.01231435, 8);
    expect(b.diffPrice).toBeCloseTo(20.70172, 4);
    // the short lost 18.48 USDT: it sold LOWER than it bought back (entry below the exit)
    expect((a.gross.price) < 82701.8 && b.gross.price < 82806.9).toBe(true);
    expect((b.gross.price - 82806.9) * 0.0489).toBeCloseTo(-18.48135, 3);
  });

  it("gilt nur ohne Einstieg, mit bekannter Seite, Menge und Ergebnis; offene Trades bekommen kein Angebot", async () => {
    const [c1, , c3] = await build()();
    expect(impliedEntries(c3!)).toBeNull();
    expect(impliedEntries({ ...c1!, side: { ...c1!.side, value: null } })).toBeNull();
    expect(impliedEntries({ ...c1!, pnl: { ...c1!.pnl, value: null } })).toBeNull();
    expect(impliedEntries({ ...c1!, exits: [{ ...c1!.exits[0]!, qty: null }] })).toBeNull();
    expect(impliedEntries({ ...c1!, entries: c3!.entries })).toBeNull();
    // without a visible fee only the fee-free reading exists
    const noFee = impliedEntries({ ...c1!, fees: { ...c1!.fees, value: null } })!;
    expect(noFee.net).toBeNull();
    expect(noFee.diffMoney).toBeNull();
  });

  it("die Vorschau sagt „Einstieg fehlt im Bild“, nennt beide Varianten samt Differenz und bietet zwei Knöpfe – übernimmt aber nichts", async () => {
    const [c1] = await build()();
    const missing = checkOf(c1!, "entry_missing");
    expect(missing).toMatchObject({ level: "warn", field: "entry" });
    expect(missing.text).toMatch(/^Einstieg fehlt im Bild/);
    expect(missing.text).toMatch(/nicht erfunden/);
    expect(missing.text).toMatch(/ohne ihn lässt sich der Trade nicht speichern/);
    const offer = checkOf(c1!, "entry_implied");
    expect(offer.level).toBe("info");
    expect(offer.text).toContain("Vorschlag, nicht gelesen");
    expect(offer.text).toContain("82.566,995 (PnL vor Gebühr)");
    expect(offer.text).toContain("82.546,32 (PnL nach Gebühr, Gebühr 1,16196029 USDT)");
    expect(offer.text).toMatch(/Unterschied: 1,16196029 USDT, im Preis 20,67545/);
    expect(offer.text).toMatch(/zeigt der Screenshot nicht/);
    expect(offer.fixes?.map((f) => f.kind === "impliedEntry" && f.basis)).toEqual(["gross", "net"]);
    expect(offer.fixes?.[0]!.label).toMatch(/^Einstieg aus PnL berechnen · ohne Gebühr/);
    // checking changes nothing
    expect(c1!.entries).toEqual([]);
    expect(c1!.entryAssumed ?? null).toBeNull();
    // the open trade and planned orders never get this
    const [, , c3] = await build()();
    expect(codes(c3!)).not.toContain("entry_missing");
    expect(codes(c3!)).toContain("no_time");
  });

  it("der Knopf setzt eine gekennzeichnete Annahme: unsicher, mit Hinweis, Prüfung „berechnet“, Ergebnis aus den Preisen", async () => {
    const [c1] = await build()();
    const edit: Edit = { id: c1!.id, kind: "impliedEntry", basis: "gross" };
    const [t] = applyEdits([c1!], [edit]);
    expect(t!.entryAssumed).toMatchObject({ basis: "gross" });
    expect(t!.entryAssumed!.price).toBeCloseTo(82566.995, 3);
    expect(t!.entries[0]).toMatchObject({ qty: 0.0562, at: null, uncertain: true });
    const entry = rowsOf(t!, "USDT").find((r) => r.key === "entry")!;
    expect(entry).toMatchObject({ label: "Einstieg (berechnet)", state: "uncertain", conf: null });
    expect(entry.note).toMatch(/Berechnet aus dem Ergebnis \(Annahme: PnL vor Gebühr\) – nicht im Screenshot gelesen/);
    expect(attentionRows(rowsOf(t!, "USDT")).map((r) => r.key)).toContain("entry");
    expect(codes(t!)).toEqual(expect.arrayContaining(["entry_assumed"]));
    expect(codes(t!)).not.toContain("entry_missing");
    expect(codes(t!)).not.toContain("pnl_ok"); // an entry computed from the result only agrees with itself
    const again = checkOf(t!, "entry_assumed");
    expect(again.text).toMatch(/berechnet, nicht gelesen \(Annahme: PnL vor Gebühr/);
    expect(again.fixes?.map((f) => (f.kind === "impliedEntry" ? f.basis : "?"))).toEqual(["net", null]);
    // the result now comes from the prices, less the fee: 7.57604 − 1.16196029 = 6.41407971
    expect(resolvedPnlMode(t!)).toBe("calc");
    // the other reading replaces it; dropping returns to „fehlt“
    const [net] = applyEdits([c1!], [edit, { id: c1!.id, kind: "impliedEntry", basis: "net" }]);
    expect(net!.entryAssumed!.basis).toBe("net");
    expect(net!.entryAssumed!.price).toBeCloseTo(82546.32, 2);
    const [dropped] = applyEdits([c1!], [{ id: c1!.id, kind: "impliedEntry", basis: "gross" }, { id: c1!.id, kind: "impliedEntry", basis: null }]);
    expect(dropped!.entries).toEqual([]);
    expect(dropped!.entryAssumed ?? null).toBeNull();
    // a value the trader types is theirs: the assumption is gone, the quantity stays
    const typed = editField(t!, "entry", "82.600,5");
    expect(typed.entryAssumed).toBeNull();
    expect(typed.entries[0]).toMatchObject({ price: 82600.5, qty: 0.0562, uncertain: false });
    expect(codes(typed)).not.toContain("entry_assumed");
  });
});

describe("Entwurf und Editor", () => {
  it("ohne Einstieg: Ausstieg, Menge, Gebühr, Hebel, Seite, Ergebnis des Börsenscreens – aber kein Einstieg, keine Einstiegszeit", async () => {
    const [c1, c2] = await build()();
    const d = toDraft(c1!, []);
    expect(d).toMatchObject({ pair: "BTC/USDT", side: "long", status: "closed", exit: 82701.8, exitDate: "2026-10-19T09:47:27", qty: 0.0562, fees: 1.16196029, leverage: 15, pnlManual: 7.57604, market: "perp" });
    expect(d.entry).toBeUndefined();
    expect(d.date).toBeUndefined();
    expect(d.size).toBeUndefined();
    expect(d.stop).toBeUndefined();
    expect(d.notes).toMatch(/Der Screenshot zeigte nur die Schließung – Einstieg und Einstiegszeit stammen nicht aus dem Bild/);
    expect(d.tags).toEqual(["Screenshot-Import"]);
    expect(toDraft(c2!, [])).toMatchObject({ side: "short", exit: 82806.9, qty: 0.0489, fees: 1.01231435, pnlManual: -18.48135 });
  });

  it("der Editor lässt so einen Entwurf nicht speichern, bis der Einstieg da ist (Pflichtfeld bleibt)", async () => {
    const [c1] = await build()();
    const { d, t } = formFromDraft(settings, "scalp", toDraft(c1!, []));
    expect(d.entry).toBe("");
    expect(d.exit).toBe("82701,8");
    expect(validateRecord(toRecord(d, t), "")).toBe("Bitte einen Einstiegspreis angeben.");
    // typed in by the trader: the draft is whole
    expect(validateRecord(toRecord({ ...d, entry: "82.566,995".replace(".", "") }, t), "")).not.toBe("Bitte einen Einstiegspreis angeben.");
  });

  it("mit übernommener Annahme: Einstieg und Menge gesetzt, Hinweis „berechnet“ in den Notizen, Ergebnis aus den Preisen", async () => {
    const [c1] = await build()();
    const [t] = applyEdits([c1!], [{ id: c1!.id, kind: "impliedEntry", basis: "gross" }]);
    const d = toDraft(t!, []);
    expect(d.entry).toBeCloseTo(82566.995, 3);
    expect(d.qty).toBe(0.0562);
    expect(d.size).toBeCloseTo(82566.995 * 0.0562, 2);
    expect(d.pnlManual).toBeUndefined(); // computed from entry and exit, fee off
    expect(d.notes).toMatch(/Einstieg 82\.566,995 berechnet aus Ausstieg, Menge und Realisiertem PnL \(Annahme: PnL vor Gebühr\) – nicht im Screenshot gelesen/);
    const { d: form, t: typed } = formFromDraft(settings, "scalp", d);
    expect(validateRecord(toRecord(form, typed), "")).toBeNull();
    // the trade is still marked as unsure by its time: the entry time is the editor's „jetzt“ until the trader sets it
    expect(d.date).toBeUndefined();
  });

  it("(3) offene Eröffnung → offener Trade-Entwurf ohne Ausstieg und ohne Ergebnis", async () => {
    const [, , c3] = await build()();
    const d = toDraft(c3!, []);
    expect(d).toMatchObject({ status: "open", side: "long", entry: 82670, qty: 0.0133, leverage: 15 });
    expect(d.size).toBeCloseTo(82670 * 0.0133, 6);
    expect(d.exit).toBeUndefined();
    expect(d.exitDate).toBeUndefined();
    expect(d.pnlManual).toBeUndefined();
    const { d: form, t } = formFromDraft(settings, "scalp", d);
    expect(t.status).toBe("open");
    expect(validateRecord(toRecord(form, t), "")).toBeNull();
  });
});

describe("Dublettenprüfung ohne Eröffnung", () => {
  it("eine Schließung wird am Ausstieg erkannt (Markt, Seite, Preis ±0,05 %, Zeit ±10 min)", async () => {
    const [c1, c2, c3] = await build()();
    const t = stored({ exitDate: "2026-10-19T09:50" });
    const dup = findDuplicate(c1!, [t])!;
    expect(dup.by).toBe("exit");
    expect(Math.round(dup.minutes)).toBe(3);
    expect(codes(c1!, [t])).toContain("duplicate");
    expect(checkOf(c1!, "entry_missing")).toBeTruthy();
    const text = checksOf(c1!, ctx([t])).find((k) => k.code === "duplicate")!.text;
    expect(text).toMatch(/Ausstieg .* % daneben/);
    expect(text).toMatch(/verglichen am Ausstieg/);
    // other side / 12 minutes apart / other price / no stored exit time → no duplicate
    expect(findDuplicate(c1!, [stored({ exitDate: "2026-10-19T09:50", side: "short" })])).toBeNull();
    expect(findDuplicate(c1!, [stored({ exitDate: "2026-10-19T10:00" })])).toBeNull();
    expect(findDuplicate(c1!, [stored({ exitDate: "2026-10-19T09:50", exit: 82800 })])).toBeNull();
    expect(findDuplicate(c1!, [stored()])).toBeNull();
    // (2) is a short: the long above is no duplicate of it
    expect(findDuplicate(c2!, [t])).toBeNull();
    // fills: the last closing fill's time counts
    const filled = stored({ exit: null, fills: [{ id: "a", at: "2026-10-19T08:00", side: "open", price: 82500, qty: 0.0562, kind: "entry" }, { id: "b", at: "2026-10-19T09:46", side: "close", price: 82701.8, qty: 0.0562, kind: "exit" }] });
    expect(findDuplicate(c1!, [filled])).not.toBeNull();
    // the open trade cannot be judged (no time): it says so
    expect(codes(c3!, [t])).toContain("dup_unjudged");
  });

  it("auch mit berechnetem Einstieg wird am Ausstieg verglichen (die Annahme hat keine Zeit)", async () => {
    const [c1] = await build()();
    const [t] = applyEdits([c1!], [{ id: c1!.id, kind: "impliedEntry", basis: "gross" }]);
    expect(findDuplicate(t!, [stored({ exitDate: "2026-10-19T09:48" })])?.by).toBe("exit");
  });
});

describe("Auftragsnamen schlagen die Sortierung und die Richtung der KI", () => {
  const ext = (over: Partial<ExtractedTrade>): Candidate => {
    const base = JSON.parse(JSON.stringify(report.trades[0])) as ExtractedTrade;
    const ex = Extraction.parse({ trades: [{ ...base, ...over }], timezone: null });
    return buildCandidates(ex, { now: NOW, zone: resolveZone(null, null, BERLIN), localZone: BERLIN, fallbackStyle: "comma" })[0]!;
  };

  it("die KI hat nach der Order-Richtung (Verkauf = Short) statt nach der Position geurteilt: „Long schließen“ bleibt Long", () => {
    const c = ext({ side: "short" });
    expect(c.side).toMatchObject({ value: "long", state: "ok" });
    expect(c.side.note).toMatch(/Position Long laut „Long schließen“ – die KI hatte Short gemeldet/);
  });

  it("die Farbe sagt nichts: ein „Short schließen“ mit positivem PnL bleibt Short, das Ergebnis behält sein Vorzeichen", () => {
    const c = ext({ side: null, realizedPnl: "+5.2", exits: [{ price: "82,806.9", qty: "0.0489", time: null, label: "Short schließen" }] });
    expect(c.side.value).toBe("short");
    expect(c.pnl.value).toBe(5.2);
  });

  it("ein Ausstieg, den die KI unter Einstiege gelegt hat, wird nach seinem Namen einsortiert und gemeldet", () => {
    const c = ext({ entries: [{ price: "82,701.8", qty: "0.0562", time: "2026-10-19 09:47:27", label: "Long schließen" }], exits: [] });
    expect(c.entries).toEqual([]);
    expect(c.exits).toHaveLength(1);
    expect(c.notes.join(" ")).toMatch(/Auftrag „Long schließen“ ist ein Ausstieg, stand aber bei den Einstiegen – umsortiert/);
  });

  it("widersprüchliche Namen (Long und Short) lassen die Richtung offen statt zu raten", () => {
    const c = ext({ side: "long", exits: [{ price: "1", qty: "1", time: null, label: "Long schließen" }, { price: "2", qty: "1", time: null, label: "Short schließen" }] });
    expect(c.side).toMatchObject({ value: "long", state: "uncertain" });
    expect(c.side.note).toMatch(/Long und Short/);
  });

  it("ein „Markt“ als Preis ist keine Zahl: der Ausstieg fehlt, das wird gesagt, das Ergebnis geht nicht verloren", () => {
    const c = ext({ exits: [{ price: "Markt", qty: "0.0562", time: null, label: "Long schließen" }] });
    expect(c.exits).toEqual([]);
    expect(c.notes.join(" ")).toMatch(/Preis nicht lesbar – ausgelassen/);
    expect(resolvedPnlMode(c)).toBe("shot");
    expect(toDraft(c, []).pnlManual).toBe(7.57604);
  });
});
