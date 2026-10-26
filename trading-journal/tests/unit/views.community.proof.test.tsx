/**
 * Ergebnisbeleg (F57) and the ranking's data class + drawdown (F50 / F71) in the UI: the public proof page (headline,
 * completeness, origin, costs, the complete list, the continuation check against an earlier version), the builder sheet
 * (preview from the journal, the posted payload) and the ranking's filter row and risk beside every row.
 */
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { setCloudEnabledForTests } from "@/cloud/env";
import { resetCloudSession, useCloudSession } from "@/cloud/session";
import { MotionRoot } from "@/motion/MotionRoot";
import type { LeaderboardResponse, ProofTrade, SharedProof } from "@/social/contract";
import { resetSocial, useSocial } from "@/social/store";
import { useJournal } from "@/store/journalStore";
import { CommunityView, SharedView } from "@/views/community";
import { mkTrade } from "./domain.fixtures";
import { bootFixtureJournal, installDomPolyfills } from "./views.overview.harness";

const USER = { id: "11111111-1111-4111-8111-111111111111", email: "t@example.com", aal: "aal1" as const, mfaEnrolled: false };
const ME = { pseudonym: "Stiller Falke 27", optIn: true, figures: { trades: 31, rTrades: 31, eligible: true, expectancyR: 0.42, winRate: 55, discipline: 81, consistency: 64, drawdownR: 3.4, origin: "api" as const, computedAt: "2026-10-12T03:00:00Z" } };

const PROOF_TRADES: ProofTrade[] = [
  ["2026-09-03", 1.5, 0.04, "api"],
  ["2026-09-10", -1, 0.05, "api"],
  ["2026-09-20", -1.2, null, "manual"],
  ["2026-09-28", null, null, "csv"],
];
const proof = (over: Partial<SharedProof> = {}): SharedProof => ({
  v: 1,
  kind: "proof",
  strategy: "Breakout 4h",
  basis: "live",
  from: "2026-09-01",
  to: "2026-10-01",
  scope: { only: null, inPeriod: PROOF_TRADES.length, open: 1 },
  trades: PROOF_TRADES,
  ...over,
});

const T = {
  proof: "P".repeat(22),
  next: "Q".repeat(22),
  gone: "R".repeat(22),
  big: "B".repeat(22),
  dropped: "D".repeat(22),
};
const payloads: Record<string, SharedProof> = {
  [T.proof]: proof(),
  // continues T.proof, all earlier trades kept, one more
  [T.next]: proof({ to: "2026-10-05", prev: T.proof, scope: { only: null, inPeriod: 5, open: 0 }, trades: [...PROOF_TRADES, ["2026-10-02", 0.8, 0.03, "api"]] }),
  // continues an earlier version that is gone
  [T.gone]: proof({ prev: "G".repeat(22) }),
  // continues T.proof but the loss of 10 Sep is missing
  [T.dropped]: proof({ prev: T.proof, scope: { only: null, inPeriod: 3, open: 0 }, trades: [PROOF_TRADES[0]!, PROOF_TRADES[2]!, PROOF_TRADES[3]!] }),
  [T.big]: proof({ scope: { only: null, inPeriod: 120, open: 0 }, trades: Array.from({ length: 120 }, (_, i) => ["2026-09-15", i % 4 ? 0.5 : -1, 0.02, "api"] as ProofTrade) }),
};

const rows = (metric: string, origin: string): LeaderboardResponse => ({
  metric: metric as LeaderboardResponse["metric"],
  origin: origin as LeaderboardResponse["origin"],
  day: "2026-10-12",
  total: 3,
  rows: [
    { rank: 1, prevRank: 2, pseudonym: "Kühner Luchs 14", value: metric === "drawdown" ? 1.2 : 1.1, trades: 22, drawdownR: 2.6, origin: "api", me: false },
    { rank: 2, prevRank: 1, pseudonym: "Ruhige Eule 81", value: metric === "drawdown" ? 2.4 : 1.01, trades: 25, drawdownR: 2.4, origin: origin === "api" ? "api" : "csv", me: false },
    { rank: 3, prevRank: null, pseudonym: "Stiller Falke 27", value: metric === "drawdown" ? 3.4 : 0.42, trades: 31, drawdownR: 3.4, origin: "api", me: true },
  ],
  mine: null,
  community: [{ metric: "expectancy", n: 24, p10: -0.35, p25: -0.05, p50: 0.18, p75: 0.45, p90: 0.85, mean: 0.21 }],
  me: ME,
  group: null,
});

const calls: { method: string; path: string; search: string; body: unknown }[] = [];

beforeAll(() => installDomPolyfills());

beforeEach(async () => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date(2026, 9, 12, 12, 0));
  await bootFixtureJournal();
  localStorage.removeItem("tj2-cloud-privacy");
  calls.length = 0;
  setCloudEnabledForTests(true);
  resetCloudSession();
  resetSocial();
  useCloudSession.setState({ phase: "signedOut" });
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: string, init: RequestInit = {}) => {
      const url = new URL(input, "https://journal.test");
      const method = (init.method ?? "GET").toUpperCase();
      const body = init.body ? JSON.parse(String(init.body)) : null;
      calls.push({ method, path: url.pathname, search: url.search, body });
      const p = url.pathname;
      if (p === "/api/v1/social/groups") return Response.json({ me: ME, groups: [], goals: [] });
      if (p === "/api/v1/social/leaderboard") return Response.json(method === "POST" ? { me: ME } : rows(url.searchParams.get("metric") ?? "expectancy", url.searchParams.get("origin") ?? "all"));
      if (p === "/api/v1/social/share") {
        if (method === "POST") return Response.json({ share: { id: "s1", token: "A".repeat(22), kind: "proof", title: "Beleg", createdAt: "2026-10-12T10:00:00Z", expiresAt: null, revoked: false, views: 0 } }, { status: 201 });
        return Response.json({ shares: [{ id: "s0", token: T.proof, kind: "proof", title: "Beleg · Breakout 4h · 4 Trades", createdAt: "2026-10-01T10:00:00Z", expiresAt: null, revoked: false, views: 2 }] });
      }
      if (p.startsWith("/api/v1/social/shared/")) {
        const payload = payloads[p.split("/").pop()!];
        if (!payload) return Response.json({ error: { code: "share_not_found", message: "Dieser Link ist abgelaufen oder wurde zurückgezogen." } }, { status: 404 });
        return Response.json({ kind: "proof", payload, createdAt: "2026-10-05T09:30:00Z", expiresAt: null, views: 7 });
      }
      return Response.json({ error: { code: "not_found", message: "Nicht gefunden." } }, { status: 404 });
    }),
  );
});

afterEach(() => {
  vi.useRealTimers();
  setCloudEnabledForTests(null);
  resetCloudSession();
  resetSocial();
  vi.unstubAllGlobals();
});

const wrap = (ui: React.ReactNode) => render(<MotionRoot>{ui}</MotionRoot>);
const signIn = () => act(() => useCloudSession.setState({ phase: "signedIn", user: USER }));

describe("Beleg-Seite (SharedView)", () => {
  it("zeigt Ergebnis und Risiko nebeneinander, die Art der Ergebnisse als Angabe und den Stand", async () => {
    wrap(<SharedView token={T.proof} />);
    const page = await screen.findByTestId("proof-page");
    expect(screen.getByRole("heading", { level: 1, name: "Ergebnisbeleg" })).toBeInTheDocument();
    expect(within(page).getByTestId("proof-strategy")).toHaveTextContent("Breakout 4h");
    expect(within(page).getByText("Echtgeld")).toBeInTheDocument();
    expect(within(page).getByText(/Die App kann das nicht prüfen/)).toBeInTheDocument();
    expect(within(page).getByTestId("proof-period")).toHaveTextContent("Zeitraum 01.09.2026 – 01.10.2026");
    expect(within(page).getByText(/Stand 05\.10\.2026/)).toBeInTheDocument();
    // the headline: the sum and the biggest drop of the same list – readable without the dot matrix
    expect(within(page).getByRole("img", { name: /Summe −0,70R/ })).toBeInTheDocument();
    expect(within(page).getByRole("img", { name: /Drawdown 2,2R/ })).toBeInTheDocument();
    expect(within(page).getByTestId("proof-n")).toHaveTextContent("4");
    expect(within(page).getByTestId("proof-n")).toHaveTextContent("3 mit R · 1 ohne R");
    // fewer than 30 trades with R: said, not hidden
    expect(within(page).getByTestId("proof-sample")).toHaveTextContent("Nur 3 Trades mit R");
    expect(screen.getByRole("img", { name: /Laufende R-Summe über 3 Trades/ })).toBeInTheDocument();
    expect(calls.map((c) => c.path)).toEqual([`/api/v1/social/shared/${T.proof}`]); // no login, no other request
  });

  it("nennt Vollständigkeit, Herkunft, Kosten und was der Beleg nicht zeigt", async () => {
    wrap(<SharedView token={T.proof} />);
    const page = await screen.findByTestId("proof-page");
    expect(within(page).getByTestId("proof-scope")).toHaveTextContent("Alle 4 geschlossenen Trades des Zeitraums sind in der Liste");
    expect(within(page).getByTestId("proof-complete")).toHaveTextContent("Zum Stand war 1 Position noch offen");
    const origin = within(page).getByTestId("proof-origin");
    expect(origin).toHaveTextContent("2 von 4 über die lesende Börsen-Schnittstelle");
    expect(origin).toHaveTextContent("1 von 4 von Hand eingetragen");
    expect(origin).toHaveTextContent("1 von 4 per Datei-Import (CSV)");
    expect(origin).toHaveTextContent("Gemischte Herkunft");
    const costs = within(page).getByTestId("proof-costs");
    expect(costs).toHaveTextContent("für 2 von 4 Trades erfasst");
    expect(costs).toHaveTextContent("Zusammen +0,09R");
    expect(costs).toHaveTextContent("Bei 2 Trades sind die Kosten nicht bekannt");
    const limits = within(page).getByTestId("proof-limits");
    expect(limits).toHaveTextContent("Selbstangabe der Person");
    expect(limits).toHaveTextContent("Vergangene Ergebnisse sind keine Prognose");
    expect(limits).toHaveTextContent("Keine professionelle Finanzberatung.");
  });

  it("eine Auswahl nennt Auswahl und Rest", async () => {
    payloads[T.proof] = proof({ scope: { only: "Box-Breakout", inPeriod: 11, open: 0 } });
    wrap(<SharedView token={T.proof} />);
    expect(await screen.findByTestId("proof-scope")).toHaveTextContent("Auswahl: nur die Grundlage „Box-Breakout“ – 4 von 11 geschlossenen Trades des Zeitraums. Die übrigen 7 stehen nicht in dieser Liste.");
  });

  it("die Liste ist vollständig: alle Einträge in Reihenfolge, Verlust wie Gewinn, kein R und unbekannte Kosten benannt", async () => {
    wrap(<SharedView token={T.proof} />);
    const history = await screen.findByTestId("proof-history");
    const rowsEl = within(history).getAllByTestId("proof-row");
    expect(rowsEl).toHaveLength(4);
    expect(rowsEl[0]).toHaveTextContent("03.09.26");
    expect(rowsEl[0]).toHaveTextContent("+1,50R");
    expect(rowsEl[1]).toHaveTextContent("−1,00R");
    expect(rowsEl[2]).toHaveTextContent("−1,20R");
    expect(rowsEl[3]).toHaveTextContent("kein R");
    expect(rowsEl[3]).toHaveTextContent("Import");
    expect(within(history).queryByTestId("proof-all")).toBeNull();
  });

  it("eine lange Liste zeigt zuerst 40 Zeilen und auf Wunsch alle", async () => {
    wrap(<SharedView token={T.big} />);
    const history = await screen.findByTestId("proof-history");
    expect(within(history).getAllByTestId("proof-row")).toHaveLength(40);
    fireEvent.click(within(history).getByTestId("proof-all"));
    expect(within(history).getAllByTestId("proof-row")).toHaveLength(120);
    expect(within(history).queryByTestId("proof-all")).toBeNull();
  });

  it("Fortschreibung: alles aus der früheren Fassung ist enthalten", async () => {
    wrap(<SharedView token={T.next} />);
    const prev = await screen.findByTestId("proof-prev");
    await waitFor(() => expect(within(prev).getByTestId("proof-prev-result")).toHaveTextContent("Alle 4 Trades der früheren Fassung vom 05.10.2026 sind enthalten; 1 ist neu dazugekommen."));
    expect(calls.map((c) => c.path)).toEqual([`/api/v1/social/shared/${T.next}`, `/api/v1/social/shared/${T.proof}`]);
  });

  it("Fortschreibung: ein weggelassener Verlust wird mit Tag und R genannt", async () => {
    wrap(<SharedView token={T.dropped} />);
    const prev = await screen.findByTestId("proof-prev");
    await waitFor(() => expect(within(prev).getByTestId("proof-prev-result")).toHaveTextContent("1 Trade der früheren Fassung vom 05.10.2026 fehlt in dieser Fassung."));
    expect(prev).toHaveTextContent("10.09.26 · −1,00R");
  });

  it("Fortschreibung: ist die frühere Fassung zurückgezogen, steht das da – kein stilles Bestehen", async () => {
    wrap(<SharedView token={T.gone} />);
    const prev = await screen.findByTestId("proof-prev");
    await waitFor(() => expect(prev).toHaveTextContent("nicht mehr abrufbar"));
    expect(prev).toHaveTextContent("lässt sich nicht prüfen");
  });
});

describe("Beleg erstellen (ProofSheet)", () => {
  const seedJournal = () =>
    act(() => {
      const t = (id: string, date: string, over: Record<string, unknown> = {}) => mkTrade({ id, date, pair: "BTCUSDT", side: "long", entry: 100, stop: 90, exit: 110, size: 500, fees: 1, setups: [], ...over } as never);
      useJournal.setState({
        trades: [
          t("a", "2026-09-03T09:00", { exit: 115 }),
          t("b", "2026-09-10T14:30", { exit: 95 }),
          t("c", "2026-09-20T08:15", { exit: 90, origin: { kind: "api" } }),
          t("d", "2026-05-01T08:00", { exit: 120 }), // before the 90-day period
          t("e", "2026-10-01T08:00", { status: "open", exit: null }),
        ],
      });
    });

  async function openSheet() {
    seedJournal();
    wrap(<CommunityView />);
    signIn();
    fireEvent.click(await screen.findByTestId("share-proof"));
    return screen.findByTestId("proof-sheet");
  }

  it("zeigt vor dem Link, was auf der Seite steht – aus dem Journal, mit dem Verlust", async () => {
    const sheet = await openSheet();
    fireEvent.change(within(sheet).getByTestId("proof-name"), { target: { value: "Breakout 4h" } });
    const preview = within(sheet).getByTestId("proof-preview");
    // 90 days up to 12.10.2026: a, b, c (d is older, e is still open)
    await waitFor(() => expect(preview).toHaveTextContent("Trades in der Liste3"));
    expect(preview).toHaveTextContent("Summe"); // a win and two losses are all in
    expect(preview).toHaveTextContent("Nie dabei: Euro-Beträge, Kontogröße, Börse, Märkte, Uhrzeiten, Notizen, dein Name.");
    expect(within(sheet).getByTestId("proof-basis-hint")).toHaveTextContent("Das kann die App nicht prüfen");
  });

  it("ohne Namen kein Link; ein leerer Zeitraum sagt es", async () => {
    const sheet = await openSheet();
    expect(within(sheet).queryByTestId("share-create")).toBeNull();
    expect(within(sheet).getByTestId("proof-error")).toHaveTextContent("Gib deiner Strategie einen Namen.");
    fireEvent.change(within(sheet).getByTestId("proof-name"), { target: { value: "X" } });
    fireEvent.change(within(sheet).getByTestId("proof-from"), { target: { value: "2026-01-01" } });
    fireEvent.change(within(sheet).getByTestId("proof-to"), { target: { value: "2026-01-31" } });
    await waitFor(() => expect(within(sheet).getByTestId("proof-error")).toHaveTextContent("keine geschlossenen Trades"));
    expect(within(sheet).queryByTestId("share-create")).toBeNull();
  });

  it("der Link-Aufruf sendet die vollständige, geschwärzte Liste – ohne Geld, Markt und Uhrzeit", async () => {
    const sheet = await openSheet();
    fireEvent.change(within(sheet).getByTestId("proof-name"), { target: { value: "Breakout 4h" } });
    await act(async () => {
      fireEvent.click(await within(sheet).findByTestId("share-create"));
    });
    const post = calls.find((c) => c.method === "POST" && c.path === "/api/v1/social/share")!;
    const payload = (post.body as { payload: SharedProof }).payload;
    expect(payload).toMatchObject({ kind: "proof", strategy: "Breakout 4h", basis: "live", from: "2026-07-14", to: "2026-10-12", scope: { only: null, inPeriod: 3, open: 1 } });
    expect(payload.trades.map((t) => t[0])).toEqual(["2026-09-03", "2026-09-10", "2026-09-20"]);
    expect(payload.trades.filter((t) => (t[1] ?? 0) < 0)).toHaveLength(2);
    expect(payload.trades[2]![3]).toBe("api");
    expect(JSON.stringify(payload)).not.toMatch(/BTCUSDT|T09:00|size|pnl|notes|"fees"/);
    await waitFor(() => expect(within(sheet).getByTestId("share-url")).toHaveValue(`${location.origin}/#share/${"A".repeat(22)}`));
  });

  it("bietet die eigenen Belege als Fortschreibung an und trägt nur das Kürzel ein", async () => {
    const sheet = await openSheet();
    fireEvent.change(within(sheet).getByTestId("proof-name"), { target: { value: "Breakout 4h" } });
    // the user's earlier proof is offered (loaded with "Deine Links")
    await waitFor(() => expect(useSocial.getState().shares.data?.length).toBe(1));
    expect(within(sheet).getByText("Fortschreibung von")).toBeInTheDocument();
  });
});

describe("Rangliste: Datenherkunft und Drawdown", () => {
  it("zeigt den Drawdown und die Herkunft an jeder Zeile und filtert nach Datenherkunft", async () => {
    wrap(<CommunityView />);
    signIn();
    const card = await screen.findByTestId("leaderboard-card");
    await waitFor(() => expect(within(card).getByTestId("podium-1")).toHaveTextContent("Kühner Luchs 14"));
    expect(within(card).getByTestId("podium-1")).toHaveTextContent("DD 2,6R");
    expect(within(card).getByTestId("podium-1")).toHaveTextContent("Börsen-API");
    expect(within(card).getByTestId("board-origin")).toHaveTextContent("Ob ein Konto Echtgeld oder Demo ist, weiß die App nicht");
    expect(within(card).getByTestId("podium-2")).toHaveTextContent("Datei-Import"); // "Ruhige Eule 81": mostly file import
    expect(within(card).getByTestId("podium-3")).toHaveTextContent("DD 3,4R");
  });

  it("der Filter fragt die Rangliste mit der Herkunft ab und erklärt die Klasse", async () => {
    wrap(<CommunityView />);
    signIn();
    const card = await screen.findByTestId("leaderboard-card");
    await waitFor(() => expect(within(card).getByTestId("podium-1")).toBeInTheDocument());
    await act(async () => {
      fireEvent.click(within(within(card).getByTestId("board-origin")).getByRole("radio", { name: "Börse" }));
    });
    await waitFor(() => expect(calls.some((c) => c.path === "/api/v1/social/leaderboard" && c.search.includes("origin=api"))).toBe(true));
    expect(within(card).getByTestId("board-origin")).toHaveTextContent("lesende Börsen-Schnittstelle");
    expect(useSocial.getState().origin).toBe("api");
  });

  it("Drawdown als Kennzahl: kleiner ist besser, der Wert steht in R, nicht doppelt als Beiwert", async () => {
    wrap(<CommunityView />);
    signIn();
    const card = await screen.findByTestId("leaderboard-card");
    await waitFor(() => expect(within(card).getByTestId("podium-1")).toBeInTheDocument());
    await act(async () => {
      fireEvent.click(within(card).getByRole("radio", { name: "Drawdown" }));
    });
    await waitFor(() => expect(calls.some((c) => c.path === "/api/v1/social/leaderboard" && c.search.includes("metric=drawdown"))).toBe(true));
    await waitFor(() => expect(within(card).getByTestId("podium-1")).toHaveTextContent("1,2R"));
    expect(within(card).getByText(/Weniger ist besser/)).toBeInTheDocument();
    // with the drawdown as the metric, the row does not repeat it as a side figure
    expect(within(card).getByTestId("podium-1")).not.toHaveTextContent("DD ");
  });

  it("Du: das Drawdown-Feld und die Herkunft der eigenen Daten", async () => {
    wrap(<CommunityView />);
    signIn();
    const you = await screen.findByTestId("you-card");
    await waitFor(() => expect(within(you).getByTestId("you-drawdown")).toHaveTextContent("3,4"));
    expect(within(you).getByTestId("you-origin")).toHaveTextContent("Börsen-API");
    expect(within(you).getByTestId("you-origin")).toHaveTextContent("nicht das ganze Vermögen");
  });
});
