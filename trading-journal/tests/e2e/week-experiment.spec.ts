/**
 * F37 Wochenreview + Wochenexperiment and F32 Verpasste Chancen end to end (no cloud, no API key).
 *
 * The clock is pinned to a fixed Wednesday (2026-10-14 12:30 Berlin), so the newest finished week is KW 41 and the running
 * one KW 42 on every run. The journal is the coach spec's kind: ~70 daily long trades on three setups, a losing neckline
 * short traded with FOMO and doubled revenge re-entries – enough for the coach to name a measurable behaviour.
 *
 * Berichte: the week review (four findings, the evidence of a finding opens as trade rows), the proposal of ONE hypothesis
 * for the next week (target value + minimum sample), accepting it is a click and survives a reload, the report of the next
 * week reads it ("läuft"), declining and withdrawing are reversible, the assistant shows the experiment and changes nothing.
 * Coach: „Verpasste Chancen“ – the honest empty archive, then seeded signal events held against the journal (gehandelt /
 * nicht gehandelt), the two actions. No horizontal scroll at 390 px, no console errors. No clock jumps, no time-dependent
 * expectations beyond the pinned week.
 */
import { expect, test, type Page } from "@playwright/test";
import { collectErrors, expectNoHorizontalScroll, openRoute, pinClock, seed, stored } from "./helpers";

const DAY = 86_400_000;
const MIN = 60_000;
const PINNED = Date.UTC(2026, 9, 14, 10, 30);

/** The journal's local wall clock ("YYYY-MM-DDTHH:mm") in the BROWSER's zone (playwright.config: Europe/Berlin). */
const BERLIN = new Intl.DateTimeFormat("sv-SE", { timeZone: "Europe/Berlin", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" });
const local = (ms: number): string => BERLIN.format(new Date(ms)).replace(" ", "T");

function rng(seed: number) {
  let a = seed;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const GLOBAL_CHECKS = ["g:trigger", "g:topdown", "g:spx", "g:stop", "g:lev"];
const SETUP_CHECKS = { s_bo: ["c1", "c2", "c3"], s_sweep: ["c1", "c2"], s_short: ["c1", "c2"] } as const;
const checksFor = (setup: keyof typeof SETUP_CHECKS, full: boolean): Record<string, boolean> =>
  Object.fromEntries([...GLOBAL_CHECKS.filter((g) => full || g !== "g:topdown"), ...SETUP_CHECKS[setup].map((c) => `${setup}:${c}`)].map((k) => [k, true]));
const SETUP = {
  s_bo: { win: 0.66, up: [1.6, 2.6], down: [-1, -0.9] },
  s_sweep: { win: 0.5, up: [1.1, 1.7], down: [-1, -0.85] },
  s_short: { win: 0.28, up: [0.9, 1.4], down: [-1.25, -1] },
} as const;

function trade(id: string, at: number, holdMin: number, setup: keyof typeof SETUP, r: number, extra: Record<string, unknown> = {}, sizeK = 1): Record<string, unknown> {
  const entry = 60_000;
  const d = entry * 0.01;
  const qty = (50 * sizeK) / d;
  return {
    account: "scalp",
    timeframe: "1h",
    target: null,
    fees: 1,
    pnlManual: null,
    checks: checksFor(setup, true),
    conviction: 3,
    followedPlan: true,
    emotion: "Ruhig",
    reason: "",
    notes: "",
    chart: "",
    pnl: null,
    r: null,
    mistakes: [],
    id,
    side: "long",
    status: "closed",
    date: local(at),
    exitDate: local(at + holdMin * MIN),
    pair: "BTC/USDT",
    entry,
    stop: entry - d,
    exit: Math.round(entry + r * d),
    size: Math.round(qty * entry),
    leverage: 3,
    setups: [setup],
    createdAt: new Date(at).toISOString(),
    updatedAt: new Date(at + holdMin * MIN).toISOString(),
    ...extra,
  };
}

function journal(now: number): Record<string, unknown>[] {
  const rand = rng(20261014);
  const out: Record<string, unknown>[] = [];
  const keys = Object.keys(SETUP) as (keyof typeof SETUP)[];
  let i = 0;
  for (let d = 68; d >= 1; d--) {
    const n = rand() < 0.2 ? 2 : 1;
    for (let j = 0; j < n; j++) {
      const setup = keys[i % 3]!;
      const s = SETUP[setup];
      const win = rand() < s.win;
      const r = win ? s.up[0] + rand() * (s.up[1] - s.up[0]) : s.down[0] + rand() * (s.down[1] - s.down[0]);
      const at = now - d * DAY - (7 - j * 3) * 3_600_000;
      const fomo = setup === "s_short" && rand() < 0.65;
      out.push(trade(`e_we_${i}`, at, 90, setup, r, { emotion: fomo ? "FOMO" : "Ruhig", mistakes: fomo && !win ? ["Zu früh rein"] : [], followedPlan: !fomo, checks: checksFor(setup, !fomo) }));
      if (setup === "s_short" && !win && i % 2 === 0) out.push(trade(`e_we_rv_${i}`, at + 100 * MIN, 45, "s_short", -1.1, { emotion: "Revenge", followedPlan: false, checks: {} }, 2));
      i++;
    }
  }
  return out;
}

interface StoredExperiments {
  experiments: { weekKey: string; recId: string; acceptedAt: string; target: number; minTrades: number }[];
  declined: string[];
}
async function weekExperiment(page: Page): Promise<StoredExperiments | null> {
  const s = await stored<{ weekExperiment?: StoredExperiments }>(page, "tj2-settings");
  return s?.weekExperiment ?? null;
}

test.describe("Wochenreview und Wochenexperiment", () => {
  test.setTimeout(180_000);

  test("Review, Hypothese annehmen, Folgewoche liest sie, Ablehnen/Zurückziehen, Assistent ändert nichts", async ({ page }) => {
    const errors = collectErrors(page);
    const c = await pinClock(page, PINNED);
    await seed(page, { clock: c.now, extra: { "tj2-trades": journal(c.now()) } });
    await openRoute(page, "/#berichte", "Berichte");

    const view = page.getByTestId("berichte-view");
    await expect(view).toHaveAttribute("data-kind", "week");
    await expect(view).toHaveAttribute("data-key", "2026-W41");

    // the review: four findings, the evidence of the first opens as trade rows
    const review = page.getByTestId("week-review");
    await expect(review).toBeVisible();
    await expect(review.getByTestId("review-finding")).toHaveCount(4);
    await expect(review.getByTestId("review-finding").first()).toContainText("nach Gebühren und Funding");
    await expect(review.getByTestId("review-finding").nth(3)).toContainText("80 %-Intervall");
    const toggle = review.getByTestId("review-evidence-toggle").first();
    await toggle.click();
    await expect(toggle).toHaveAttribute("aria-expanded", "true");
    expect(await review.locator("[data-trade-id]").count()).toBeGreaterThanOrEqual(1);
    await toggle.click();

    // ONE hypothesis for the next week, with the target value and the minimum sample – nothing is stored yet
    const card = page.getByTestId("week-experiment");
    const proposal = card.getByTestId("experiment-proposal");
    await expect(proposal).toBeVisible();
    await expect(proposal.getByTestId("experiment-target")).toContainText(/^Nächste Woche: .+ – bei mindestens 5 Trades\.$/);
    await expect(proposal).toContainText("in einer Woche nicht prüfbar");
    expect(await weekExperiment(page)).toBeNull();
    await expectNoHorizontalScroll(page);

    // decline → shown as declined, stored, reversible
    await card.getByTestId("experiment-decline").click();
    await expect(proposal).toHaveAttribute("data-declined", "1");
    await expect.poll(async () => (await weekExperiment(page))?.declined.length ?? 0).toBe(1);
    await card.getByTestId("experiment-undecline").click();
    await expect(proposal).toHaveAttribute("data-declined", "0");
    await expect.poll(async () => (await weekExperiment(page))?.declined.length ?? 0).toBe(0);

    // accept → stored for KW 42, and it survives a reload
    await card.getByTestId("experiment-accept").click();
    await expect(card.getByTestId("experiment-accepted")).toBeVisible();
    await expect.poll(async () => (await weekExperiment(page))?.experiments[0]?.weekKey).toBe("2026-W42");
    const stored1 = await weekExperiment(page);
    expect(stored1?.experiments).toHaveLength(1);
    expect(stored1?.experiments[0]).toMatchObject({ minTrades: 5 });

    // the report of the next week reads the experiment: the week is still running
    await page.getByTestId("report-next").click();
    await expect(view).toHaveAttribute("data-key", "2026-W42");
    const result = page.getByTestId("week-experiment").getByTestId("experiment-result");
    await expect(result).toHaveAttribute("data-status", "läuft");
    await expect(page.getByTestId("experiment-text")).toContainText("Die Woche läuft noch");
    await expectNoHorizontalScroll(page);

    // the assistant shows it – and changes nothing
    const before = JSON.stringify(await weekExperiment(page));
    await page.getByTestId("assistant-button").click();
    const dialog = page.getByRole("dialog", { name: "Assistent" });
    await expect(dialog).toBeVisible();
    await page.getByTestId("assistant-input").fill("Wie läuft mein Wochenexperiment?");
    await page.getByTestId("assistant-send").click();
    const entry = dialog.getByTestId("assistant-entry").last();
    await expect(entry).toContainText("Dein Wochenexperiment");
    await expect(entry).toContainText("KW 42 (läuft)");
    await expect(entry).toContainText("Sollwert");
    expect(JSON.stringify(await weekExperiment(page))).toBe(before);
    await dialog.getByRole("button", { name: "Schließen" }).click();
    await expect(dialog).toBeHidden({ timeout: 15_000 });

    // back in KW 41 the accepted experiment is still there – also after a reload (stored in the settings)
    await page.getByTestId("report-prev").click();
    await expect(view).toHaveAttribute("data-key", "2026-W41");
    await expect(page.getByTestId("experiment-accepted")).toBeVisible();
    await page.reload();
    await expect(page.getByTestId("week-experiment").getByTestId("experiment-accepted")).toBeVisible();

    // withdraw → the proposal is back
    await page.getByTestId("experiment-withdraw").click();
    await expect(page.getByTestId("experiment-proposal")).toBeVisible();
    await expect.poll(async () => (await weekExperiment(page))?.experiments.length ?? 0).toBe(0);

    // other report kinds have neither card
    await page.getByRole("radio", { name: "Monat" }).click();
    await expect(page.getByTestId("week-experiment")).toHaveCount(0);
    await expect(page.getByTestId("week-review")).toHaveCount(0);
    expect(errors).toEqual([]);
  });
});

test.describe("Verpasste Chancen", () => {
  test.setTimeout(120_000);

  test("leeres Archiv sagt ehrlich, was gespeichert wird", async ({ page }) => {
    const errors = collectErrors(page);
    const c = await pinClock(page, PINNED);
    await seed(page, { clock: c.now, extra: { "tj2-trades": journal(c.now()) } });
    await openRoute(page, "/#coach", "Coach", { attached: true });
    const card = page.getByTestId("missed-card");
    await card.scrollIntoViewIfNeeded();
    await expect(card).toBeVisible();
    await expect(card).toHaveAttribute("data-total", "0");
    await expect(card).toContainText("Noch keine Signale gespeichert");
    await expect(card).toContainText("Vergangenes lässt sich nicht nachtragen");
    await expect(page.getByTestId("missed-counter")).toContainText("keine Ursache");
    await expectNoHorizontalScroll(page);
    expect(errors).toEqual([]);
  });

  test("gespeicherte Signale gegen das Journal: gehandelt, nicht gehandelt, Aktionen", async ({ page }) => {
    const errors = collectErrors(page);
    const c = await pinClock(page, PINNED);
    const now = c.now();
    const ev = (key: string, at: number, over: Record<string, unknown>) => ({ id: `s_${key}`, key, at, source: "entry", kind: "entry", entry: true, symbol: "BTCUSDT", side: "long", tf: "1h", label: `Starker Long-Einstieg ${key}`, detail: "Score 85", strength: 3, score: 85, ref: null, watch: false, ...over });
    // the seeded trade of yesterday sits at now − 1 d − 7 h (a long on BTC/USDT)
    const items = [
      ev("traded", now - DAY - 7 * 3_600_000 + 20 * MIN, {}),
      ev("missed-short", now - 2 * DAY - 3 * 3_600_000, { side: "short", label: "Starker Short-Einstieg missed-short" }),
      ev("missed-box", now - 30 * 3_600_000, { side: "short", source: "box", kind: "setup", tf: "4h", label: "A+-Setup · Range-Short", detail: "Einstieg 60.000" }),
      ev("context", now - 5 * 3_600_000, { source: "box", kind: "breakout", entry: false }),
    ];
    await seed(page, { clock: c.now, extra: { "tj2-trades": journal(now), "tj2-signal-events": { v: 1, items } } });
    await openRoute(page, "/#coach", "Coach", { attached: true });
    const card = page.getByTestId("missed-card");
    await card.scrollIntoViewIfNeeded();
    await expect(card).toHaveAttribute("data-missed", "2");
    await expect(card).toContainText("3 (1 gehandelt · 2 nicht gehandelt · 0 offen)");
    const rows = card.getByTestId("missed-row");
    await expect(rows).toHaveCount(2);
    await expect(rows.first()).toContainText("Box-zu-Box");
    await expect(rows.first()).toContainText("▼ Short");
    await expect(page.getByTestId("missed-counter")).toContainText("Stichprobe: 2 verpasste, 1 gehandelte Signale.");
    await expect(page.getByTestId("missed-limits")).toContainText("bewusst ausgelassen oder übersehen");

    // Beobachten is a persisted mark
    await rows.nth(1).getByTestId("missed-watch").click();
    await expect(rows.nth(1)).toContainText("beobachtet");
    await expect
      .poll(async () => ((await stored<{ items: { key: string; watch: boolean }[] }>(page, "tj2-signal-events"))?.items ?? []).filter((e) => e.watch).map((e) => e.key))
      .toEqual(["missed-short"]);
    await expectNoHorizontalScroll(page);

    // Testen opens the Labor
    await rows.first().getByTestId("missed-test").click();
    await expect(page.locator("h1", { hasText: "Labor" }).first()).toBeVisible();
    expect(errors).toEqual([]);
  });
});
