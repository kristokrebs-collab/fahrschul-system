/**
 * Auswertung → "Ergebnis nach Signal-Stärke" with Einstiegs-Check v2 snapshots on the trades: the "Kerzenschluss" table
 * (stark bestätigt · bestätigt · vorläufig · ohne Status) and the effect rows of the graded parts (Top-Trader-Kombi with
 * its items; a trade without top-trader data counted apart, never as "not met"), also listed in the info panel.
 */
import { expect, test } from "@playwright/test";
import { collectErrors, fixture, scrollUntilVisible, seed } from "./helpers";

/** A stored snapshot (the other journal's `SignalSnap` fields + our v2 extras). */
function snap(state: string | null, traders: "ok" | "open" | "none" | null): Record<string, unknown> {
  const data = traders !== "none";
  const ok = traders === "ok";
  return {
    at: "2026-03-02T10:00:00.000Z",
    side: "long",
    score: 80,
    strength: state === "provisional" ? 0 : 3,
    tiers: 3,
    label: state === "provisional" ? "Vorläufig: Sehr starker Long-Einstieg" : "Sehr starker Long-Einstieg",
    valid: state !== "provisional",
    rsiOk: true,
    zoneOk: true,
    zone: "discount",
    deep: false,
    tfs: [{ tf: "30m", kind: "bottom", wt: -50.1, rsi: 38.2 }],
    ...(state ? { v: 2, state, provStrength: 3 } : {}),
    ...(traders
      ? {
          parts: [
            {
              id: "traders",
              grade: ok ? 1 : data ? 0.25 : 0,
              points: ok ? 10 : data ? 2.5 : 0,
              weight: 10,
              ok,
              data,
              state: "confirmed",
              met: ok ? 4 : data ? 1 : 0,
              items: ["pos", "acc", "retail", "zone"].map((id) => ({ id, met: data ? ok || id === "zone" : null, raw: data ? 1 : null })),
            },
          ],
        }
      : {}),
  };
}

test("Signal-Stärke: Kerzenschluss table and the Top-Trader-Kombi effect rows from v2 snapshots", async ({ page }, info) => {
  const errors = collectErrors(page);
  const plan: [string | null, "ok" | "open" | "none" | null][] = [
    ["strong", "ok"],
    ["confirmed", "open"],
    ["provisional", "none"],
    ["confirmed", "ok"],
    [null, null],
  ];
  // the first five CLOSED fixture trades get a snapshot each (the card evaluates closed trades)
  const closedIds = (fixture["tj2-trades"] as Record<string, unknown>[]).filter((t) => t.status === "closed").map((t) => t.id);
  const trades = (fixture["tj2-trades"] as Record<string, unknown>[]).map((t) => {
    const i = closedIds.indexOf(t.id);
    return i >= 0 && i < plan.length ? { ...t, signal: snap(...plan[i]!) } : t;
  });
  await seed(page, { extra: { "tj2-trades": trades } });
  await page.goto("/#overview");
  const card = page.getByTestId("insights-signal");
  await scrollUntilVisible(page, card);
  await expect(card).toContainText("5 Trades mit Check");

  const states = card.getByTestId("insights-signal-state");
  await expect(states).toBeVisible();
  for (const label of ["Stark bestätigt", "Bestätigt", "Vorläufig (Kerze offen)", "Ohne Status"]) await expect(states).toContainText(label);
  await expect(states).not.toContainText("Kein Einstieg");

  const traders = card.getByTestId("insights-signal-part-traders");
  await expect(traders).toContainText("Top-Trader-Kombi erfüllt");
  await expect(traders).toContainText("mit 2");
  await expect(traders).toContainText("ohne 1");
  await expect(traders).toContainText("keine Daten 1");
  for (const k of ["traders-pos", "traders-acc", "traders-retail"]) await expect(card.getByTestId(`insights-signal-part-${k}`)).toBeVisible();
  await card.screenshot({ path: info.outputPath("insights-signal-v2.png"), animations: "disabled" });

  // the info panel lists the same part rows
  await card.getByRole("button", { name: "Details zeigen: Ergebnis nach Signal-Stärke" }).click();
  await expect(card).toContainText("Neuere Checks speichern auch den Kerzenschluss");
  await expect(card).toContainText("· Top-Trader Positionen");
  await expect(card).toContainText("1 ohne Daten");
  expect(errors, errors.join("\n")).toEqual([]);
});
