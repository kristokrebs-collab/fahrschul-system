/**
 * Watchlist (`settings.watchlist`, versioned passthrough, ≤ 50) and the news monitor's rules (F67/F68): keyword hints with
 * the words that caused them, duplicate merging, the "new since your last visit" mark and the ordering.
 */
import { describe, expect, it } from "vitest";
import { merge3 } from "@/store/merge3";
import { markNew, mergeNews, orderNews, rateHeadline, titleKey, urlKey, withinWindow, type SourceItem } from "@/domain/newsmonitor";
import { addToWatchlist, MAX_WATCHLIST, normalizeItem, normalizeSymbol, removeFromWatchlist, stockSymbols, watchId, watchlistCfgOf, withWatchlist, type WatchItem } from "@/domain/watchlist";

const item = (kind: "stock" | "crypto", symbol: string, extra: Partial<WatchItem> = {}): WatchItem => ({ id: watchId(kind, symbol), kind, symbol, name: null, addedAt: 1, note: "", ...extra });

describe("watchlist", () => {
  it("reads tickers the way people type them", () => {
    expect(normalizeSymbol("stock", " aapl ")).toBe("AAPL");
    expect(normalizeSymbol("stock", "brk-b")).toBe("BRK.B");
    expect(normalizeSymbol("stock", "TOOLONGX")).toBeNull();
    expect(normalizeSymbol("stock", "12AB")).toBeNull();
    expect(normalizeSymbol("stock", "")).toBeNull();
    expect(normalizeSymbol("crypto", "btcusdt")).toBe("BTCUSDT");
    expect(normalizeSymbol("crypto", "BINANCE:ETHUSDT.P")).toBe("ETHUSDT");
    expect(normalizeSymbol("crypto", "sol")).toBe("SOLUSDT");
    expect(normalizeSymbol("crypto", "BTC/USDT")).toBe("BTCUSDT");
    expect(normalizeSymbol("crypto", "$$$")).toBeNull();
  });

  it("adds, refuses duplicates and invalid tickers, and stops at 50", () => {
    let items: WatchItem[] = [];
    const a = addToWatchlist(items, { kind: "stock", symbol: "aapl", name: " Apple Inc. " }, 5);
    expect(a.ok && a.item).toEqual({ id: "stock:AAPL", kind: "stock", symbol: "AAPL", name: "Apple Inc.", addedAt: 5, note: "" });
    items = a.ok ? a.items : [];
    expect(addToWatchlist(items, { kind: "stock", symbol: "AAPL" }, 6)).toEqual({ ok: false, reason: "duplicate" });
    expect(addToWatchlist(items, { kind: "crypto", symbol: "$$$" }, 6)).toEqual({ ok: false, reason: "invalid" });
    expect(addToWatchlist(items, { kind: "stock", symbol: "A B" }, 6)).toEqual({ ok: false, reason: "invalid" });
    expect(addToWatchlist(items, { kind: "crypto", symbol: "doge" }, 6)).toMatchObject({ ok: true, item: { id: "crypto:DOGEUSDT" } }); // a bare coin means its USDT pair
    const full = Array.from({ length: MAX_WATCHLIST }, (_, i) => item("crypto", `C${i}USDT`));
    expect(addToWatchlist(full, { kind: "stock", symbol: "MSFT" }, 7)).toEqual({ ok: false, reason: "limit" });
    expect(removeFromWatchlist(items, "stock:AAPL")).toEqual([]);
    expect(stockSymbols([item("stock", "AAPL"), item("crypto", "BTCUSDT"), item("stock", "MSFT")])).toEqual(["AAPL", "MSFT"]);
  });

  it("reads anything leniently: bad entries are set aside, duplicates and the 51st dropped, ids rebuilt", () => {
    expect(watchlistCfgOf(undefined).items).toEqual([]);
    expect(watchlistCfgOf("x").items).toEqual([]);
    const raw = {
      v: 1,
      items: [{ kind: "stock", symbol: "aapl", id: "wrong", addedAt: 3 }, { kind: "stock", symbol: "AAPL" }, { kind: "bond", symbol: "X" }, "text", { kind: "crypto", symbol: "ETH", name: "  ", note: "x".repeat(300) }],
    };
    const cfg = watchlistCfgOf(raw);
    expect(cfg.items.map((i) => i.id)).toEqual(["stock:AAPL", "crypto:ETHUSDT"]);
    expect(cfg.items[0]!.addedAt).toBe(3);
    expect(cfg.items[1]).toMatchObject({ name: null, addedAt: 0 });
    expect(cfg.items[1]!.note).toHaveLength(140);
    expect(cfg.rejected).toEqual([{ kind: "bond", symbol: "X" }, "text"]);
    const many = { items: Array.from({ length: 60 }, (_, i) => ({ kind: "crypto", symbol: `C${i}USDT` })) };
    expect(watchlistCfgOf(many).items).toHaveLength(50);
    expect(normalizeItem({ kind: "stock", symbol: "AAPL", addedAt: Number.NaN })!.addedAt).toBe(0);
  });

  it("writes without losing what it does not understand, and returns the same object when nothing changes", () => {
    const stored = { v: 1, items: [{ id: "stock:AAPL", kind: "stock", symbol: "AAPL", name: null, addedAt: 1, note: "" }, { kind: "futureKind", symbol: "X" }], later: { keep: true } };
    const items = watchlistCfgOf(stored).items;
    expect(withWatchlist(stored, items)).toBe(stored);
    const next = withWatchlist(stored, [...items, item("crypto", "BTCUSDT")]);
    expect(next.later).toEqual({ keep: true });
    expect(next.v).toBe(1);
    expect((next.items as unknown[]).slice(-1)).toEqual([{ kind: "futureKind", symbol: "X" }]); // unreadable entry travels on
    expect(watchlistCfgOf(next).items.map((i) => i.id)).toEqual(["stock:AAPL", "crypto:BTCUSDT"]);
    expect(withWatchlist(undefined, [item("stock", "MSFT")])).toMatchObject({ v: 1, items: [{ id: "stock:MSFT" }] });
  });

  it("merges two devices per entry (settings merge3 on the id list)", () => {
    const base = withWatchlist(undefined, [item("stock", "AAPL")]);
    const mine = withWatchlist(base, [item("stock", "AAPL"), item("stock", "MSFT")]);
    const theirs = withWatchlist(base, [item("stock", "AAPL"), item("crypto", "BTCUSDT")]);
    const merged = merge3(base, mine, theirs) as { items: WatchItem[] };
    expect(merged.items.map((i) => i.id).sort()).toEqual(["crypto:BTCUSDT", "stock:AAPL", "stock:MSFT"]);
  });
});

/* ------------------------------------------------------------------ news monitor */

const src = (symbol: string, title: string, at: number, url = `https://news.example/${titleKey(title).replace(/ /g, "-")}`, origin = "yahoo-rss"): SourceItem => ({ id: title, symbol, title, url, publisher: "news.example", publishedAt: at, summary: null, origin });

describe("headline rating", () => {
  const r = rateHeadline;

  it("rates what can move a stock overnight as high – with the words that caused it", () => {
    expect(r("Acme files for Chapter 11 bankruptcy protection")).toMatchObject({ level: "high", score: 3, tags: ["risk"], matched: ["Chapter 11"] });
    expect(r("Big Pharma to acquire Acme in $5 billion takeover")).toMatchObject({ level: "high", tags: ["deal"], matched: ["acquire"] });
    expect(r("Acme sues rival over patents")).toMatchObject({ level: "high", tags: ["legal"], matched: ["sues"] });
    expect(r("Trading halted in Acme pending news")).toMatchObject({ level: "high", tags: ["halt"] });
    expect(r("Acme übernimmt Konkurrent: Übernahme für 2 Mrd.")).toMatchObject({ level: "high", tags: ["deal"], matched: ["Übernahme"] });
    expect(r("Acme: Klage gegen Hersteller eingereicht").tags).toEqual(["legal"]);
  });

  it("rates company events as medium", () => {
    expect(r("Acme earnings: revenue tops $2 billion").level).toBe("medium");
    expect(r("Acme raises full-year guidance").tags).toEqual(["earnings"]);
    expect(r("Acme announces $1B stock buyback").tags).toEqual(["capital"]);
    expect(r("Acme CEO steps down after 10 years")).toMatchObject({ level: "medium", tags: ["people"] });
    expect(r("Acme names new CFO")).toMatchObject({ level: "medium", tags: ["people"] });
    expect(r("FDA approves Acme's drug").tags).toEqual(["regulatory"]);
    expect(r("Acme beats estimates in the third quarter").tags).toEqual(["earnings"]);
  });

  it("rates commentary as low and shows its tag", () => {
    expect(r("Analyst upgrades Acme to Buy, price target $50")).toMatchObject({ level: "low", score: 1, tags: ["analyst"] });
    expect(r("Stock market today: Fed holds rates, Dow edges up")).toMatchObject({ level: "low", tags: ["macro"] });
  });

  it("does not read what is not there", () => {
    expect(r("3 Stocks to Buy Right Now")).toMatchObject({ level: "low", score: 0, tags: [], matched: [] });
    expect(r("Wall Street settles lower as tech slides").tags).toEqual(["macro"]); // not a lawsuit
    expect(r("Acme CEO says the future is bright").tags).toEqual([]); // not a management change
    expect(r("Space probe reaches Mars").tags).toEqual([]); // "probe" counts only as an inquiry
    expect(r("DOJ probe into Acme pricing")).toMatchObject({ level: "high", tags: ["legal", "regulatory"] });
    expect(r("Regulators probe of Acme deepens").tags).toEqual(["legal"]);
    expect(r("Acme issues new product").tags).toEqual([]); // "sues" inside "issues" does not count
  });

  it("weighs a headline with three kinds of news a little more", () => {
    const x = r("Acme earnings beat estimates as lawsuit settlement ends probe and Acme names new CEO to lead restructuring");
    expect(x.tags.length).toBeGreaterThanOrEqual(3);
    expect(x.score).toBe(3);
  });
});

describe("merging, new-marks and order", () => {
  it("folds the same story from several tickers and sources into one line", () => {
    const merged = mergeNews(
      [
        src("TSLA", "Tesla and SpaceX merger talks heat up", 100, "https://www.example.com/a/b/?utm_source=x&id=1"),
        src("NVDA", "Tesla and SpaceX merger talks heat up!", 90, "https://example.com/a/b?id=1&.tsrc=rss", "sec-edgar"),
        src("AAPL", "A different story about Apple", 80),
        src("TSLA", "Same words, other link: Tesla and SpaceX merger talks heat up", 70, "https://other.example/x"),
      ],
      ["NVDA", "TSLA", "AAPL"],
    );
    expect(merged).toHaveLength(3);
    expect(merged[0]).toMatchObject({ symbols: ["NVDA", "TSLA"], origins: ["yahoo-rss", "sec-edgar"], publishedAt: 100 });
    expect(merged[0]!.rating.tags).toContain("deal");
  });

  it("merges titles with the same words, but never very short ones", () => {
    const a = mergeNews([src("A", "Acme rises", 1, "https://x.example/1"), src("B", "Acme rises", 2, "https://y.example/2")]);
    expect(a).toHaveLength(2);
    const b = mergeNews([src("A", "Acme shares rise after a surprise announcement", 1, "https://x.example/1"), src("B", "ACME shares rise after a surprise announcement", 2, "https://y.example/2")]);
    expect(b).toHaveLength(1);
    expect(b[0]!.symbols).toEqual(["A", "B"]);
    expect(urlKey("not a url")).toBeNull();
    expect(urlKey("https://www.Example.com/a/b/#top")).toBe("example.com/a/b");
  });

  it("marks only what is newer than the last visit – and nothing on a first visit", () => {
    const items = mergeNews([src("A", "Newer story about Acme and more", 200), src("A", "Older story about Acme and more", 100)]);
    expect(markNew(items, 150).map((i) => i.isNew)).toEqual([true, false]);
    expect(markNew(items, 200).map((i) => i.isNew)).toEqual([false, false]);
    expect(markNew(items, null).map((i) => i.isNew)).toEqual([false, false]);
    expect(items.every((i) => !i.isNew)).toBe(true); // the input is not touched
  });

  it("orders by importance and then time, or by time only", () => {
    const items = mergeNews([
      src("A", "Analyst upgrades Acme with a new price target", 500),
      src("A", "Acme files for bankruptcy protection today", 100),
      src("A", "Acme quarterly results top revenue forecasts", 300),
      src("A", "Acme opens new store in the city centre", 400),
    ]);
    expect(orderNews(items, "importance").map((i) => i.rating.level)).toEqual(["high", "medium", "low", "low"]);
    expect(orderNews(items, "importance").map((i) => i.publishedAt)).toEqual([100, 300, 500, 400]);
    expect(orderNews(items, "newest").map((i) => i.publishedAt)).toEqual([500, 400, 300, 100]);
  });

  it("keeps the stories of a time window", () => {
    const items = mergeNews([src("A", "Fresh story about Acme and the market", 9_000), src("A", "Stale story about Acme and the market", 1_000)]);
    expect(withinWindow(items, 10_000, 2_000).map((i) => i.publishedAt)).toEqual([9_000]);
    expect(withinWindow(items, 10_000, Infinity)).toHaveLength(2);
  });
});
