/**
 * Handelsplan · der Link `#plan?symbol=…&side=…`: was verstanden, was übergangen und gesagt wird, welcher Markt aus einem Kürzel
 * folgt, und was das Formular beim Wechsel zwischen Krypto und Aktien mitnimmt.
 */
import { describe, expect, it } from "vitest";
import { DEFAULT_FORM, formMarket, formOf, formPatchFor, linkPatch, parsePlanLink, planLinkHash, sessionForMarket, symbolFits, symbolMarket, type PlanForm } from "@/domain/plan";
import { pageOfHash } from "@/intro/introBoot";
import { parseHash } from "@/store/router";

const stock = (over: Partial<PlanForm> = {}): PlanForm => formOf({ ...DEFAULT_FORM, symbol: "AAPL", session: "usstocks", ...over });

describe("welcher Markt ein Kürzel ist", () => {
  it("US-Aktien: ein bis fünf Buchstaben, mit Klassenzusatz", () => {
    for (const s of ["AAPL", "F", "KO", "BRK.B", "BF-B", "GOOGL", "aapl"]) expect(symbolMarket(s), s).toBe("stocks");
  });
  it("Krypto-Perpetuals: Basiswert + USDT / USDC – auch wenn die Form eine Aktie sein könnte", () => {
    for (const s of ["BTCUSDT", "ETHUSDC", "1000PEPEUSDT", "SUSDT"]) expect(symbolMarket(s), s).toBe("crypto");
  });
  it("alles andere ist keins von beiden", () => {
    for (const s of ["", "A B", "@@@", "TOOLONGTICKER", "BTC/USDT", "123", "BRK.BB", "-A"]) expect(symbolMarket(s), s).toBeNull();
  });
  it("das Formular nimmt je Markt nur passende Kürzel", () => {
    expect(symbolFits("AAPL", "stocks")).toBe(true);
    expect(symbolFits("BTCUSDT", "stocks")).toBe(false);
    expect(symbolFits("BTCUSDT", "crypto")).toBe(true);
    expect(symbolFits("AAPL", "crypto")).toBe(true); // Krypto bleibt großzügig: die Börse sagt später, ob es das Symbol gibt
    expect(symbolFits("BRK.B", "crypto")).toBe(false);
  });
});

describe("parsePlanLink", () => {
  it("versteht, was die Seite Aktien schreibt – mit und ohne #plan?", () => {
    const want = { present: true, symbol: "AAPL", market: "stocks", side: "long", ignored: [], query: "symbol=AAPL&side=long" };
    expect(parsePlanLink("#plan?symbol=AAPL&side=long")).toEqual(want);
    expect(parsePlanLink("symbol=AAPL&side=long")).toEqual(want);
    expect(parsePlanLink("?symbol=aapl&side=LONG")).toEqual(want);
    expect(parsePlanLink(planLinkHash("AAPL", "long"))).toEqual(want);
  });

  it("Krypto und Short, Klassenzusatz mit Punkt", () => {
    expect(parsePlanLink("#plan?symbol=BTCUSDT&side=short")).toMatchObject({ symbol: "BTCUSDT", market: "crypto", side: "short", ignored: [] });
    expect(parsePlanLink(planLinkHash("BRK.B", "short"))).toMatchObject({ symbol: "BRK.B", market: "stocks", side: "short", query: "symbol=BRK.B&side=short" });
  });

  it("nur ein Teil: das andere bleibt leer", () => {
    expect(parsePlanLink("symbol=MSFT")).toMatchObject({ present: true, symbol: "MSFT", side: null, query: "symbol=MSFT" });
    expect(parsePlanLink("side=short")).toMatchObject({ present: true, symbol: null, side: "short", query: "side=short" });
  });

  it("ein ungültiges Kürzel wird übergangen und gesagt – die Richtung gilt trotzdem", () => {
    const l = parsePlanLink("#plan?symbol=%40%40%40&side=long");
    expect(l.symbol).toBeNull();
    expect(l.side).toBe("long");
    expect(l.ignored).toHaveLength(1);
    expect(l.ignored[0]).toContain("Das Kürzel „@@@“ aus dem Link ist weder eine US-Aktie");
    expect(l.query).toBe("side=long");
  });

  it("eine unbekannte Richtung wird übergangen und gesagt", () => {
    const l = parsePlanLink("symbol=AAPL&side=sideways");
    expect(l.side).toBeNull();
    expect(l.symbol).toBe("AAPL");
    expect(l.ignored).toEqual(["Die Richtung „sideways“ aus dem Link ist keine – erlaubt sind long und short – ignoriert."]);
  });

  it("leere und unbekannte Teile", () => {
    expect(parsePlanLink("symbol=").ignored).toEqual(["Das Kürzel im Link ist leer – ignoriert."]);
    const l = parsePlanLink("symbol=AAPL&foo=1&day=2026-10-19");
    expect(l.symbol).toBe("AAPL");
    expect(l.ignored).toEqual(["„foo“ im Link kennt der Handelsplan nicht – ignoriert.", "„day“ im Link kennt der Handelsplan nicht – ignoriert."]);
  });

  it("ein langer Wert wird gekürzt gezeigt, nichts wirft", () => {
    const l = parsePlanLink(`symbol=${"X".repeat(200)}`);
    expect(l.ignored[0]).toContain(`„${"X".repeat(24)}…“`);
    expect(() => parsePlanLink("symbol=%E0%A4%A&side=%")).not.toThrow();
  });

  it("ohne Anfrage: nichts da", () => {
    for (const s of ["", "#plan", "#plan?"]) expect(parsePlanLink(s).present, s).toBe(false);
    expect(parsePlanLink("#plan")).toMatchObject({ symbol: null, side: null, ignored: [], query: "" });
  });

  it("der erste Wert eines doppelten Schlüssels gilt", () => {
    expect(parsePlanLink("symbol=AAPL&symbol=MSFT")).toMatchObject({ symbol: "AAPL", ignored: [] });
  });
});

describe("der Link stört andere Hash-Routen nicht", () => {
  it("der Router erkennt die Seite und reicht die Anfrage durch; die Einführung kennt das Fragezeichen schon", () => {
    expect(parseHash("#plan?symbol=AAPL&side=long")).toEqual({ page: "plan", query: "symbol=AAPL&side=long" });
    expect(parseHash("#plan")).toEqual({ page: "plan" });
    expect(pageOfHash("#plan?symbol=AAPL&side=long")).toBe("plan");
  });
  it("andere Seiten behalten ihr Verhalten: Trades-Filter, Analyse, ein Unbekanntes mit Anfrage", () => {
    expect(parseHash("#trades?result=win")).toMatchObject({ page: "trades", filter: expect.objectContaining({ result: "win" }) });
    expect(parseHash("#analyse?dim=session")).toEqual({ page: "analyse", query: "dim=session" });
    expect(parseHash("#aktien?symbol=AAPL")).toEqual({ page: "aktien" });
    expect(parseHash("#nirgends?symbol=AAPL")).toEqual({ page: "overview" });
  });
});

describe("formOf: das Kürzel muss zum Markt der Sitzung passen", () => {
  it("eine Aktien-Sitzung nimmt Aktienkürzel, auch mit einem oder zwei Buchstaben", () => {
    expect(formOf({ symbol: "ko", session: "usstocks" }).symbol).toBe("KO");
    expect(formOf({ symbol: "f", session: "usstocks" }).symbol).toBe("F");
    expect(formOf({ symbol: "brk.b", session: "usstocks" }).symbol).toBe("BRK.B");
  });
  it("ein Krypto-Kürzel in einer Aktien-Sitzung (und umgekehrt) fällt auf ein Beispiel zurück", () => {
    expect(formOf({ symbol: "BTCUSDT", session: "usstocks" }).symbol).toBe("AAPL");
    expect(formOf({ symbol: "BRK.B", session: "newyork" }).symbol).toBe("BTCUSDT");
  });
  it("Krypto bleibt, wie es war", () => {
    expect(formOf({ symbol: "ethusdt" }).symbol).toBe("ETHUSDT");
    expect(formOf({ symbol: "x" }).symbol).toBe("BTCUSDT");
  });
});

describe("formPatchFor: Markt- und Symbolwechsel", () => {
  it("Krypto → Aktie: US-Börse, und alles, was nur für Krypto galt, geht", () => {
    const cur = formOf({ ...DEFAULT_FORM, tf: "1h", orMinutes: 60, session: "utc", manualEntry: 84_200, lot: 0.001, tick: 0.1, cutoffMin: 240, flatBy: "20:00", day: "2026-10-19", stop: { kind: "price", price: 83_000 }, target: { kind: "level", price: 90_000, name: "Marke" }, leverage: 5 });
    const patch = formPatchFor(cur, { symbol: "AAPL", market: "stocks" });
    expect(patch).toMatchObject({ symbol: "AAPL", session: "usstocks", manualEntry: null, lot: null, tick: null, cutoffMin: null, flatBy: null, day: null, stop: { kind: "range-mid" }, target: { kind: "r", r: 2 }, tf: "5m", orMinutes: 60 });
    const next = formOf({ ...cur, ...patch });
    expect(formMarket(next)).toBe("stocks");
    expect(next.symbol).toBe("AAPL");
    expect(next.leverage).toBe(5); // wirkt bei Aktien nicht, bleibt aber für den Weg zurück
  });

  it("Aktie → Krypto: New-York-Sitzung, die Kerzenlänge bleibt", () => {
    const patch = formPatchFor(stock({ tf: "15m", orMinutes: 15 }), { symbol: "BTCUSDT", market: "crypto" });
    expect(patch).toMatchObject({ symbol: "BTCUSDT", session: sessionForMarket("crypto"), day: null, manualEntry: null });
    expect(patch.tf).toBeUndefined();
  });

  it("dasselbe Kürzel ändert nichts", () => {
    expect(formPatchFor(stock(), { symbol: "AAPL", market: "stocks" })).toEqual({});
  });

  it("ein anderes Kürzel im selben Markt lässt die für das alte getippten Preise zurück", () => {
    const cur = stock({ manualEntry: 190.5, stop: { kind: "price", price: 180 }, target: { kind: "price", price: 200 }, day: "2026-10-20" });
    expect(formPatchFor(cur, { symbol: "MSFT", market: "stocks" })).toEqual({ symbol: "MSFT", manualEntry: null, day: null, stop: { kind: "range-mid" }, target: { kind: "r", r: 2 } });
  });

  it("die Range bleibt ein Vielfaches der Kerzenlänge", () => {
    const patch = formPatchFor(formOf({ ...DEFAULT_FORM, tf: "30m", orMinutes: 30, session: "newyork" }), { symbol: "AAPL", market: "stocks" });
    expect(patch.orMinutes).toBeUndefined(); // 30 Minuten passen zu 30-Minuten-Kerzen
    const odd = formPatchFor(formOf({ ...DEFAULT_FORM, tf: "1h", orMinutes: 60, session: "utc" }), { symbol: "AAPL", market: "stocks" });
    expect(odd.tf).toBe("5m");
    expect(odd.orMinutes).toBe(60); // 60 ist ein Vielfaches von 5
  });
});

describe("linkPatch", () => {
  it("Markt und Richtung zusammen; die Richtung gilt für das Signal und für den Vorab-Plan", () => {
    const patch = linkPatch(formOf(DEFAULT_FORM), parsePlanLink("symbol=AAPL&side=short"));
    expect(patch).toMatchObject({ symbol: "AAPL", session: "usstocks", sides: "short", manualSide: "short" });
  });
  it("nur die Richtung: der Markt bleibt", () => {
    expect(linkPatch(stock(), parsePlanLink("side=long"))).toEqual({ sides: "long", manualSide: "long" });
  });
  it("was schon so ist, ändert nichts; was nichts verlangt, auch nicht", () => {
    expect(linkPatch(stock({ sides: "long", manualSide: "long" }), parsePlanLink("symbol=AAPL&side=long"))).toEqual({});
    expect(linkPatch(stock(), parsePlanLink("symbol=@@@"))).toEqual({});
    expect(linkPatch(stock(), parsePlanLink(""))).toEqual({});
  });
  it("Krypto aus einer anderen Seite: Krypto-Sitzung, aus einer Aktien-Sitzung heraus", () => {
    expect(linkPatch(stock(), parsePlanLink("symbol=ETHUSDT"))).toMatchObject({ symbol: "ETHUSDT", session: "newyork" });
  });
});
