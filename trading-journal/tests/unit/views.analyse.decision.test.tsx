/**
 * F24 Karte „Entscheidung: du, Regelwerk, KI“ (Analyse › Vergleich): der Leerzustand sagt, wie man Herkunft setzt; mit gesetzten
 * Herkünften erscheinen die drei Gruppen mit Stichprobenwort und Spannen, die kleine Gruppe als „Zu wenig Daten“ (ohne Zahlen),
 * die Paare mit Urteil – ohne „besser“; „Herkunft nachtragen“ schreibt genau den angetippten Trade; das KI-Protokoll zeigt, was
 * protokolliert wurde, und lässt sich leeren.
 */
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { withAiLog, appendEntry } from "@/domain/provenance";
import type { Trade } from "@/domain/types";
import { MotionRoot } from "@/motion/MotionRoot";
import { getAccountView, getEnriched, useJournal } from "@/store/journalStore";
import { DecisionCard } from "@/views/analyse/decision/DecisionCard";
import { fixtureTrades, SETTINGS } from "./analytics.fixtures";
import { bootFixtureJournal, installDomPolyfills } from "./views.overview.harness";

function Card() {
  const trades = useJournal((s) => s.trades);
  const settings = useJournal((s) => s.settings);
  const view = getAccountView(getEnriched(trades, settings), settings, "all");
  return <DecisionCard view={view} cur={settings.currency} />;
}
const renderCard = () =>
  render(
    <MotionRoot>
      <Card />
    </MotionRoot>,
  );

/** The fixture journal with `own` on 24, `rules` on 15 and `ai` on 3 of the closed trades. */
function marked(): Trade[] {
  const all = fixtureTrades().filter((t) => t.status === "closed");
  const mark = (from: number, n: number, by: "own" | "rules" | "ai") => all.slice(from, from + n).map((t) => ({ ...t, decision: { by } }));
  return [...mark(0, 24, "own"), ...mark(24, 15, "rules"), ...mark(39, 3, "ai"), ...all.slice(42)];
}

describe("Karte Entscheidung", () => {
  beforeAll(() => installDomPolyfills());
  beforeEach(async () => {
    await bootFixtureJournal();
    await act(async () => {
      useJournal.setState({ trades: fixtureTrades(), settings: SETTINGS });
    });
  });

  it("ohne gesetzte Herkunft: sagt es, und bietet das Nachtragen an", () => {
    renderCard();
    const card = screen.getByTestId("ana-decision");
    expect(within(card).getByTestId("decision-headline")).toHaveTextContent("Noch keine Trades mit Herkunft");
    expect(within(card).queryByTestId("decision-groups")).toBeNull();
    expect(within(card).getByTestId("decision-unassigned")).toHaveTextContent("60 von 60 geschlossenen Trades haben keine Herkunft");
  });

  it("mit Herkunft: drei Gruppen, die kleine als „Zu wenig Daten“, Paare mit Urteil – und kein „besser“", async () => {
    await act(async () => {
      useJournal.setState({ trades: marked() });
    });
    renderCard();
    const groups = within(screen.getByTestId("decision-groups")).getAllByTestId("decision-group");
    expect(groups.map((g) => [g.dataset.by, g.dataset.n, g.dataset.enough])).toEqual([
      ["own", "24", "1"],
      ["rules", "15", "1"],
      ["ai", "3", "0"],
    ]);
    expect(groups[0]).toHaveTextContent(/Trefferquote\s*\d+ % \(\d+–\d+ %\)/);
    expect(groups[0]).toHaveTextContent(/Stichprobe: tragfähig/);
    const ai = groups[2]!;
    expect(within(ai).getByTestId("decision-few")).toHaveTextContent("Zu wenig Daten");
    expect(ai).not.toHaveTextContent("Trefferquote");
    const pairs = screen.getAllByTestId("decision-pair");
    expect(pairs).toHaveLength(3);
    expect(pairs.find((p) => p.dataset.pair === "own-ai")!.dataset.comparable).toBe("0");
    expect(pairs.find((p) => p.dataset.pair === "own-rules")!.dataset.comparable).toBe("1");
    expect(screen.getByTestId("ana-decision").textContent).not.toMatch(/ist besser|ist schlechter|überlegen/i);
    expect(screen.getByTestId("decision-unassigned")).toHaveTextContent("18 von 60");
  });

  it("„Herkunft nachtragen“: ein Tipp schreibt genau diesen Trade, der Trade verlässt die Liste", async () => {
    renderCard();
    fireEvent.click(screen.getByTestId("decision-assign-toggle"));
    const rows = await screen.findAllByTestId("decision-assign-row");
    expect(rows).toHaveLength(8);
    const first = rows[0]!;
    const id = first.dataset.trade!;
    const before = useJournal.getState().trades.find((t) => t.id === id)!;
    expect(before.decision).toBeUndefined();
    fireEvent.click(within(first).getByRole("radio", { name: "Regelwerk" }));
    await waitFor(() => expect(useJournal.getState().trades.find((t) => t.id === id)!.decision).toEqual({ by: "rules" }));
    const after = useJournal.getState().trades.find((t) => t.id === id)!;
    expect(after.updatedAt >= before.updatedAt).toBe(true);
    // nur dieser Trade, sonst nichts am Journal
    expect(useJournal.getState().trades.filter((t) => t.decision).map((t) => t.id)).toEqual([id]);
    await waitFor(() => expect(screen.getByTestId("decision-assign-status")).toHaveTextContent("Herkunft gespeichert"));
    expect(within(screen.getByTestId("decision-assign")).queryAllByTestId("decision-assign-row").some((r) => r.dataset.trade === id)).toBe(false);
  });

  it("ein Hinweis auf ein zeitlich passendes Signal ist keine Vorauswahl", async () => {
    renderCard();
    fireEvent.click(screen.getByTestId("decision-assign-toggle"));
    const rows = await screen.findAllByTestId("decision-assign-row");
    for (const r of rows) expect(within(r).queryAllByRole("radio", { checked: true })).toHaveLength(0);
  });

  it("KI-Protokoll: leer sagt es ehrlich, gefüllt zeigt es Helfer, Modell und Übernahme – und lässt sich leeren", async () => {
    renderCard();
    fireEvent.click(screen.getByTestId("decision-log-toggle"));
    expect(await screen.findByTestId("decision-ailog-empty")).toBeInTheDocument();
    const entries = appendEntry(appendEntry([], { helper: "assistant", model: "claude-opus-5-5", adopted: true, at: 1_000 }, "ai_1", 1_000), { helper: "assistant", model: "claude-opus-5-5", adopted: false, at: 2_000 }, "ai_2", 2_000);
    await act(async () => {
      useJournal.setState({ settings: { ...useJournal.getState().settings, aiLog: withAiLog(undefined, entries) } });
    });
    const row = await screen.findByTestId("decision-ailog-row");
    expect(row.dataset.helper).toBe("assistant");
    expect(row).toHaveTextContent("2 Aufrufe");
    expect(row).toHaveTextContent("übernommen 1 von 2");
    expect(row).toHaveTextContent("claude-opus-5-5");
    expect(screen.getByTestId("decision-ailog")).toHaveTextContent("kein Gespräch, keine Frage und keine Antwort");
    fireEvent.click(screen.getByTestId("decision-ailog-clear"));
    await waitFor(() => expect(screen.getByTestId("decision-ailog-empty")).toBeInTheDocument());
  });
});
