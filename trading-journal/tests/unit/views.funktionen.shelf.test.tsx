/**
 * Page "Funktionen" (A7): favourites and "Zuletzt benutzt" in `settings.funktionen` (versioned, passthrough, merges per id), the
 * three honest answers per function (verfügbar / Einrichtung nötig / im höheren Tarif with the next step), one symbol per
 * function – and the stars, the status chips and the upgrade step on the page itself.
 */
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const open = vi.hoisted(() => vi.fn());
const upgrade = vi.hoisted(() => vi.fn());
vi.mock("@/app/featureOpen", () => ({ openFeature: open }));
vi.mock("@/assistant/open", () => ({ openAssistant: vi.fn() }));

import { FEATURE_GROUPS, FEATURE_REGISTRY, featureById } from "@/app/features";
import { defaultSettings } from "@/domain/defaults";
import { normalizeSettings } from "@/domain/normalize";
import { merge3 } from "@/store/merge3";
import { MotionRoot } from "@/motion/MotionRoot";
import { useBilling } from "@/billing/store";
import { setCloudEnabledForTests } from "@/cloud/env";
import { resetCloudSession, useCloudSession } from "@/cloud/session";
import { useSearch } from "@/search/searchStore";
import { useJournal } from "@/store/journalStore";
import { FunktionenView } from "@/views/funktionen";
import { GLYPH_IDS, glyphKindOf } from "@/views/funktionen/glyphs";
import { EMPTY_SHELF, FAVORITES_MAX, RECENT_MAX, isFavorite, markUsed, shelfOf, toggleFavorite, withShelf } from "@/views/funktionen/shelf";
import { rememberFunction, toggleFavoriteFunction } from "@/views/funktionen/shelfStore";
import { availabilityOf } from "@/views/funktionen/status";
import { installDomPolyfills } from "./views.overview.harness";

vi.mock("@/billing/store", async (orig) => ({ ...(await orig<typeof import("@/billing/store")>()), openUpgrade: upgrade }));

const CONFIG = { enabled: true, trialDays: 14, referralTrialDays: 30, cardless: false, prices: {}, available: ["pro", "premium", "team"] } as const;

function reduceMotion() {
  window.matchMedia = ((q: string) => ({ matches: q.includes("reduced-motion"), media: q, onchange: null, addListener() {}, removeListener() {}, addEventListener() {}, removeEventListener() {}, dispatchEvent: () => false })) as unknown as typeof window.matchMedia;
}

describe("shelf (settings.funktionen)", () => {
  it("reads a broken key as empty and keeps only valid, unique ids, newest first", () => {
    expect(shelfOf({})).toEqual(EMPTY_SHELF);
    expect(shelfOf({ funktionen: "kaputt" })).toEqual(EMPTY_SHELF);
    const s = shelfOf({
      funktionen: {
        favorites: [{ id: "tagesplan", at: 5 }, { id: "Tages Plan", at: 9 }, { id: "tagesplan", at: 1 }, { id: "backup", at: 8 }, 7, null],
        recent: [{ id: "x", at: "gestern" }],
      },
    });
    expect(s.favorites).toEqual([
      { id: "backup", at: 8 },
      { id: "tagesplan", at: 5 },
    ]);
    expect(s.recent).toEqual([{ id: "x", at: 0 }]);
  });

  it("toggles favourites (newest first, bounded) and moves a used function to the front without duplicates", () => {
    let s = toggleFavorite(EMPTY_SHELF, "tagesplan", 10);
    s = toggleFavorite(s, "backup", 20);
    expect(s.favorites.map((f) => f.id)).toEqual(["backup", "tagesplan"]);
    expect(isFavorite(s, "backup")).toBe(true);
    expect(toggleFavorite(s, "backup", 30).favorites.map((f) => f.id)).toEqual(["tagesplan"]);
    expect(toggleFavorite(s, "not a slug!", 1)).toBe(s);
    let many = EMPTY_SHELF;
    for (let i = 0; i < FAVORITES_MAX + 5; i++) many = toggleFavorite(many, `f${i}`, i + 1);
    expect(many.favorites).toHaveLength(FAVORITES_MAX);
    expect(many.favorites[0]!.id).toBe(`f${FAVORITES_MAX + 4}`);

    let r = markUsed(EMPTY_SHELF, "labor", 1);
    r = markUsed(r, "backup", 2);
    r = markUsed(r, "labor", 3);
    expect(r.recent.map((x) => x.id)).toEqual(["labor", "backup"]);
    expect(markUsed(r, "labor", 4)).toBe(r);
    for (let i = 0; i < RECENT_MAX + 3; i++) r = markUsed(r, `g${i}`, 10 + i);
    expect(r.recent).toHaveLength(RECENT_MAX);
  });

  it("writes a versioned key, leaves every other key and unknown keys inside it alone, and survives normalize and merge3", () => {
    const base = { ...defaultSettings(), funktionen: { v: 1, zukunft: "bleibt", favorites: [], recent: [] } };
    const next = withShelf(base, toggleFavorite(EMPTY_SHELF, "tagesplan", 5));
    expect((next as unknown as { funktionen: Record<string, unknown> }).funktionen).toMatchObject({ v: 1, zukunft: "bleibt", favorites: [{ id: "tagesplan", at: 5 }] });
    expect(next.currency).toBe(base.currency);
    expect(shelfOf(normalizeSettings(JSON.parse(JSON.stringify(next)))).favorites).toHaveLength(1);
    // two devices each starred something: both stay (arrays of objects with an id merge per id)
    const a = withShelf(base, toggleFavorite(EMPTY_SHELF, "tagesplan", 5));
    const b = withShelf(base, toggleFavorite(EMPTY_SHELF, "backup", 6));
    const merged = merge3(base, a, b) as typeof base;
    expect(shelfOf(merged).favorites.map((f) => f.id).sort()).toEqual(["backup", "tagesplan"]);
  });
});

describe("availability: verfügbar / Einrichtung nötig / im höheren Tarif", () => {
  const ctx = { open: true, plan: "free" as const, signedIn: false };
  const f = (id: string) => featureById(id)!;

  it("says 'im höheren Tarif' with the cheapest plan and the next step – only while payments are open", () => {
    expect(availabilityOf(f("labor"), ctx)).toMatchObject({ kind: "tarif", plan: "premium" });
    expect(availabilityOf(f("labor"), ctx).next).toMatch(/Premium/);
    expect(availabilityOf(f("gesamtrisiko"), ctx)).toMatchObject({ kind: "tarif", plan: "pro" });
    expect(availabilityOf(f("labor"), { ...ctx, plan: "premium" }).kind).not.toBe("tarif");
    expect(availabilityOf(f("labor"), { ...ctx, open: false }).kind).not.toBe("tarif");
  });

  it("says 'Einrichtung nötig' for an account, a server key or a group – and 'verfügbar' once the account is there", () => {
    expect(availabilityOf(f("gruppen"), { ...ctx, plan: "premium" })).toMatchObject({ kind: "einrichtung", next: expect.stringMatching(/Konto/) });
    expect(availabilityOf(f("gruppen"), { ...ctx, plan: "premium", signedIn: true }).kind).toBe("verfuegbar");
    expect(availabilityOf(f("zahlen-analyst"), { ...ctx, plan: "pro", signedIn: true }).kind).toBe("einrichtung"); // the server's SEC access
    expect(availabilityOf(f("reviews"), { ...ctx, signedIn: true }).kind).toBe("einrichtung"); // "Erscheint in einer Gruppe"
  });

  it("says 'verfügbar' for a plain function and for one whose precondition only says where its card shows up", () => {
    expect(availabilityOf(f("tagesplan"), ctx).kind).toBe("verfuegbar");
    expect(availabilityOf(f("robustheit"), { ...ctx, plan: "premium" }).kind).toBe("verfuegbar"); // "Erscheint nach einem fertigen Lauf."
  });

  it("answers for every function of the register (no throw, a known kind)", () => {
    for (const e of FEATURE_REGISTRY) expect(["verfuegbar", "einrichtung", "tarif"], e.id).toContain(availabilityOf(e, ctx).kind);
  });
});

describe("one symbol per function", () => {
  it("names only functions that exist, each once, and every group has a fallback symbol", () => {
    const ids = new Set(FEATURE_REGISTRY.map((e) => e.id));
    for (const id of GLYPH_IDS) expect(ids.has(id), id).toBe(true);
    expect(new Set(GLYPH_IDS).size).toBe(GLYPH_IDS.length);
    // most of the register has a drawing of its own; the rest shows its group's symbol
    expect(GLYPH_IDS.length).toBeGreaterThan(FEATURE_REGISTRY.length * 0.85);
    expect(glyphKindOf("alarme")).toBe("bell");
    expect(glyphKindOf("does-not-exist")).toBeUndefined();
    expect(FEATURE_GROUPS).toHaveLength(12);
  });
});

describe("page: stars, status and the next step", () => {
  beforeAll(() => {
    installDomPolyfills();
    reduceMotion();
  });
  beforeEach(() => {
    open.mockClear();
    upgrade.mockClear();
    localStorage.clear();
    setCloudEnabledForTests(true);
    resetCloudSession();
    useSearch.setState({ recent: [] });
    useBilling.setState({ config: null, account: null, cached: null });
    useJournal.setState({ settings: defaultSettings() });
  });
  afterEach(() => {
    setCloudEnabledForTests(null);
    resetCloudSession();
    vi.useRealTimers();
  });

  const renderPage = () =>
    render(
      <MotionRoot>
        <FunktionenView />
      </MotionRoot>,
    );
  const tile = (id: string) => screen.getAllByTestId("funktionen-tile").find((t) => t.getAttribute("data-group") === id)!;

  it("shows no favourites box without favourites, and the stars start empty", () => {
    renderPage();
    expect(screen.queryByTestId("funktionen-favorites")).toBeNull();
    fireEvent.click(tile("heute"));
    for (const star of screen.getAllByTestId("feature-star")) expect(star).toHaveAttribute("aria-pressed", "false");
  });

  it("a star keeps a function in 'Favoriten' (settings.funktionen) and takes it out again", async () => {
    // the real store writes through `saveSettings`; here it only has to land in the state
    const save = vi.fn(async (s: ReturnType<typeof defaultSettings>) => void useJournal.setState({ settings: s }));
    useJournal.setState({ saveSettings: save } as never);
    renderPage();
    fireEvent.click(tile("heute"));
    const row = screen.getAllByTestId("feature-row").find((r) => r.getAttribute("data-feature") === "tagesplan")!;
    fireEvent.click(within(row).getByTestId("feature-star"));
    await waitFor(() => expect(save).toHaveBeenCalledTimes(1));
    expect(shelfOf(useJournal.getState().settings).favorites.map((f) => f.id)).toEqual(["tagesplan"]);
    expect(within(row).getByTestId("feature-star")).toHaveAttribute("aria-pressed", "true");
    fireEvent.click(screen.getByRole("button", { name: "Zurück zu allen Aufgaben" }));
    const box = screen.getByTestId("funktionen-favorites");
    expect(within(box).getAllByTestId("feature-favorite").map((r) => r.getAttribute("data-feature"))).toEqual(["tagesplan"]);
    // un-star from the favourites list
    fireEvent.click(within(within(box).getByTestId("feature-favorite")).getByTestId("feature-star"));
    await waitFor(() => expect(screen.queryByTestId("funktionen-favorites")).toBeNull());
    expect(shelfOf(useJournal.getState().settings).favorites).toEqual([]);
  });

  it("lists favourites of the settings (also from another device), unknown ids are simply not shown", () => {
    const s = defaultSettings();
    useJournal.setState({ settings: withShelf(s, { v: 1, favorites: [{ id: "backup", at: 3 }, { id: "gibt-es-nicht", at: 2 }, { id: "tagesplan", at: 1 }], recent: [] }) });
    renderPage();
    const box = screen.getByTestId("funktionen-favorites");
    expect(box).toHaveAttribute("data-n", "2");
    expect(within(box).getAllByTestId("feature-favorite").map((r) => r.getAttribute("data-feature"))).toEqual(["backup", "tagesplan"]);
  });

  it("'Zuletzt benutzt' reads the settings list first, then the search's list", () => {
    useJournal.setState({ settings: withShelf(defaultSettings(), { v: 1, favorites: [], recent: [{ id: "labor", at: 9 }, { id: "backup", at: 5 }] }) });
    useSearch.setState({ recent: ["feature:belastungstest"] });
    renderPage();
    const recent = within(screen.getByTestId("funktionen-recent")).getAllByTestId("feature-quick");
    expect(recent.map((r) => r.getAttribute("data-feature"))).toEqual(["labor", "backup", "belastungstest"]);
  });

  it("opening a function counts it as used (the one writer behind every way of opening)", async () => {
    const save = vi.fn(async (s: ReturnType<typeof defaultSettings>) => void useJournal.setState({ settings: s }));
    useJournal.setState({ saveSettings: save } as never);
    expect(rememberFunction("labor", 5)).toBe(true);
    await waitFor(() => expect(save).toHaveBeenCalled());
    expect(shelfOf(useJournal.getState().settings).recent).toEqual([{ id: "labor", at: 5 }]);
    expect(rememberFunction("labor", 6)).toBe(false); // already first: no write
    expect(toggleFavoriteFunction("labor", 7)).toBe(true);
    expect(toggleFavoriteFunction("kein slug", 8)).toBe(false);
  });

  it("every row says what you can do now; a function of a higher plan says the next step and opens the upgrade sheet", () => {
    useBilling.setState({ config: { ...CONFIG, available: [...CONFIG.available] } });
    act(() => useCloudSession.setState({ phase: "signedOut" }));
    renderPage();
    fireEvent.click(tile("testen"));
    const labor = screen.getAllByTestId("feature-row").find((r) => r.getAttribute("data-feature") === "labor")!;
    expect(labor).toHaveAttribute("data-availability", "tarif");
    expect(within(labor).getByTestId("feature-availability")).toHaveTextContent("Im höheren Tarif · ab Premium");
    expect(within(labor).getByTestId("feature-next")).toHaveTextContent("Tarif Premium wählen");
    fireEvent.click(within(labor).getByTestId("feature-upgrade"));
    expect(upgrade).toHaveBeenCalledWith("backtestLab", "premium");
  });

  it("nothing is 'im höheren Tarif' while payments are not set up: every function is simply available", () => {
    useBilling.setState({ config: { ...CONFIG, available: [...CONFIG.available], enabled: false } });
    renderPage();
    fireEvent.click(tile("testen"));
    for (const row of screen.getAllByTestId("feature-row")) expect(row.getAttribute("data-availability"), row.getAttribute("data-feature")!).not.toBe("tarif");
    expect(screen.queryByTestId("feature-next")).toBeNull();
  });

  it("says 'Verfügbar' on a plain row, 'Einrichtung nötig' with the step in the details, and draws a symbol on every row", () => {
    useBilling.setState({ config: { ...CONFIG, available: [...CONFIG.available], enabled: false } });
    renderPage();
    fireEvent.click(tile("heute"));
    const plan = screen.getAllByTestId("feature-row").find((r) => r.getAttribute("data-feature") === "tagesplan")!;
    expect(within(plan).getByTestId("feature-availability")).toHaveTextContent("Verfügbar");
    expect(within(plan).queryByTestId("feature-next")).toBeNull();
    const mail = screen.getAllByTestId("feature-row").find((r) => r.getAttribute("data-feature") === "email-alarm")!;
    expect(mail).toHaveAttribute("data-availability", "einrichtung");
    fireEvent.click(within(mail).getByTestId("feature-details"));
    expect(within(mail).getByTestId("feature-detail-panel")).toHaveTextContent("Nächster Schritt");
    for (const row of screen.getAllByTestId("feature-row")) expect(within(row).getByTestId("feature-glyph").querySelector("svg"), row.getAttribute("data-feature")!).not.toBeNull();
  });
});
