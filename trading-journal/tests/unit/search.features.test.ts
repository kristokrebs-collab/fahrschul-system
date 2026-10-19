/**
 * The global search knows the function register: deep links with the function's name, its group and page, found by typing
 * "Labor" or a keyword, ranked next to the pages – and the chosen hit opens the function (a page scrolled to the card, or its sheet).
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { FEATURE_REGISTRY } from "@/app/features";
import { featureSearchId } from "@/app/featureQuery";
import { defaultSettings } from "@/domain/defaults";
import { flatHits, searchIndex, suggestions } from "@/search/rank";
import { buildSearchIndex, KIND_LABEL, type IndexInput } from "@/search/sources";

const NOW = new Date("2026-10-12T12:00").getTime();
const PAGES = ["overview", "trades", "setups", "settings", "labor", "coach", "funktionen"];

function input(over: Partial<IndexInput> = {}): IndexInput {
  return {
    trades: [],
    settings: defaultSettings(),
    days: {},
    pages: PAGES,
    labels: { overview: "Übersicht", trades: "Trades", setups: "Entscheidungsgrundlagen", settings: "Einstellungen", labor: "Labor", coach: "Coach", funktionen: "Funktionen" },
    pageKeys: { funktionen: "f" },
    now: NOW,
    features: FEATURE_REGISTRY,
    ...over,
  };
}

describe("search index with the function register", () => {
  it("adds one item per function with a deep-link action; without the register there are none", () => {
    const items = buildSearchIndex(input());
    const fs = items.filter((i) => i.kind === "feature");
    expect(fs).toHaveLength(FEATURE_REGISTRY.length);
    expect(fs.find((i) => i.id === featureSearchId("belastungstest"))).toMatchObject({
      title: "Kosten- und Belastungstest",
      subtitle: "Testen · Labor",
      action: { type: "feature", id: "belastungstest" },
    });
    expect(new Set(items.map((i) => i.id)).size).toBe(items.length);
    expect(KIND_LABEL.feature).toBe("Funktionen");
    expect(buildSearchIndex(input({ features: undefined })).some((i) => i.kind === "feature")).toBe(false);
    // the page "Funktionen" is a page like the others, with its g-chord
    expect(items.find((i) => i.id === "page:funktionen")).toMatchObject({ title: "Funktionen", keys: "g f" });
  });

  it("finds 'Labor' as a page AND as functions, and a keyword that is on no page title", () => {
    const items = buildSearchIndex(input());
    const groups = searchIndex(items, "Labor");
    const kinds = groups.map((g) => g.kind);
    expect(kinds).toContain("page");
    expect(kinds).toContain("feature");
    const features = groups.find((g) => g.kind === "feature")!;
    expect(features.hits.length).toBeGreaterThan(2);
    expect(features.hits.every((h) => h.item.action.type === "feature")).toBe(true);
    expect(flatHits(searchIndex(items, "slippage")).some((h) => h.item.id === featureSearchId("belastungstest"))).toBe(true);
    expect(flatHits(searchIndex(items, "backup"))[0]!.item.id).toBe(featureSearchId("backup"));
  });

  it("marks an unfinished function in the result row and shows it among the suggestions only when it was used", () => {
    const items = buildSearchIndex(input());
    expect(items.find((i) => i.id === featureSearchId("tv-vergleich"))!.meta).toBe("teilweise");
    expect(items.find((i) => i.id === featureSearchId("labor"))!.meta).toBeUndefined();
    const none = suggestions({ items, trades: [], settings: defaultSettings(), recent: [] });
    expect(none.some((g) => g.kind === "feature")).toBe(false);
    const used = suggestions({ items, trades: [], settings: defaultSettings(), recent: [featureSearchId("labor")] });
    expect(used.find((g) => g.kind === "recent")!.hits[0]!.item.id).toBe(featureSearchId("labor"));
  });
});

describe("search action 'feature'", () => {
  afterEach(() => vi.restoreAllMocks());

  it("opens the function through the register after the overlay closed", async () => {
    const open = vi.fn();
    vi.doMock("@/app/featureOpen", () => ({ openFeature: open }));
    const { runSearchAction } = await import("@/search/actions");
    runSearchAction({ type: "feature", id: "labor" });
    await vi.waitFor(() => expect(open).toHaveBeenCalledWith("labor", { remember: false }));
    vi.doUnmock("@/app/featureOpen");
  });
});
