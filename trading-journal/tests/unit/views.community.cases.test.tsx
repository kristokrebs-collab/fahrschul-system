/**
 * Chartfälle (F47) in the UI: the future stays out of the picture (and out of its scale) until the hypothesis is stored,
 * the form refuses an empty or short one, the stored hypothesis posts once and the card then shows the continuation and
 * the result worked out from the candles, a closed case shows everybody's hypotheses with the verdict, mentor groups
 * keep the posting to mentors, and the new-case sheet only posts a case whose candles exist.
 */
import { act, configure, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { setCloudEnabledForTests } from "@/cloud/env";
import { resetCloudSession, useCloudSession } from "@/cloud/session";
import { MotionRoot } from "@/motion/MotionRoot";
import type { CaseInfo, FeedResponse, GroupsResponse, HypothesisInfo } from "@/social/contract";
import { resetSocial } from "@/social/store";
import { CommunityView } from "@/views/community";
import { __resetCaseBars } from "@/views/community/cases/useCaseBars";
import { bootFixtureJournal, installDomPolyfills } from "./views.overview.harness";

const H4 = 14_400_000;
const ANCHOR = Date.UTC(2026, 9, 1, 0, 0);
const USER = { id: "11111111-1111-4111-8111-111111111111", email: "t@example.com", aal: "aal1" as const, mfaEnrolled: false };
const OTHER = "22222222-2222-4222-8222-222222222222";
const ME = { pseudonym: "Stiller Falke 27", optIn: false, figures: null };
const GROUP_ID = "abcdabcd-0000-4000-8000-00000000a001";

/** What the mocked exchange answers: flat at 100 up to the anchor, then +1 % per candle (so 12 candles = +12 %). */
const loader = vi.hoisted(() => ({ fail: false, calls: [] as { symbol: string; from: number; to: number }[], anchor: 0 }));
vi.mock("@/views/labor/historySource", () => ({
  loadLabData: vi.fn(async (req: { symbol: string; intervals: string[]; from: number; to: number }) => {
    loader.calls.push({ symbol: req.symbol, from: req.from, to: req.to });
    if (loader.fail) throw new TypeError("Failed to fetch");
    const iv = 14_400_000;
    const bars = [];
    for (let t = Math.ceil(req.from / iv) * iv; t <= req.to; t += iv) {
      const k = Math.max(0, Math.round((t - loader.anchor) / iv));
      const close = t <= loader.anchor ? 100 : 100 * (1 + 0.01 * k);
      const open = t <= loader.anchor ? 100 : 100 * (1 + 0.01 * (k - 1));
      bars.push({ t: t / 1000, o: open, h: Math.max(open, close) + 1, l: Math.min(open, close) - 1, c: close });
    }
    return { data: { [req.intervals[0]!]: bars }, funding: null, pages: 1, viaProxy: false };
  }),
  loadErrorKind: () => "blocked",
}));

const hyp = (over: Partial<HypothesisInfo> = {}): HypothesisInfo => ({ author: "Ruhige Eule 81", authorId: OTHER, me: false, direction: "up", confidence: 70, reason: "Ausbruch über die Box mit Volumen", createdAt: new Date(ANCHOR + H4 + 3600_000).toISOString(), ...over });
const mkCase = (over: Partial<CaseInfo> = {}): CaseInfo => ({
  id: "abcdabcd-0000-4000-8000-0000000000c1",
  groupId: GROUP_ID,
  author: "Ruhige Eule 81",
  authorId: OTHER,
  me: false,
  pair: "BTCUSDT",
  interval: "4h",
  anchorMs: ANCHOR,
  horizon: 12,
  question: "Hält die Box nach oben?",
  closesAt: new Date(Date.UTC(2026, 9, 30)).toISOString(),
  closed: false,
  createdAt: new Date(Date.UTC(2026, 9, 18)).toISOString(),
  hypotheses: 0,
  mine: null,
  revealed: [],
  ...over,
});

const feed = (cases: CaseInfo[], o: { kind?: "group" | "mentor"; role?: "owner" | "member" | "student" } = {}): FeedResponse => ({
  group: {
    id: GROUP_ID,
    kind: o.kind ?? "group",
    name: "Morgenrunde",
    description: "",
    role: o.role ?? "member",
    members: 2,
    openReviews: 0,
    createdAt: "2026-10-01T08:00:00Z",
    ownerId: OTHER,
    shareLevel: "none",
    memberList: [],
    invites: [],
    averages: null,
    seats: null,
  },
  reviews: [],
  cases,
});

let current: FeedResponse;
const calls: { method: string; path: string; body: unknown }[] = [];

beforeAll(() => {
  installDomPolyfills();
  // lazy chunks and a loaded machine: async queries wait longer than the default second (the end state is what is checked)
  configure({ asyncUtilTimeout: 15_000 });
});

beforeEach(async () => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date(Date.UTC(2026, 9, 20, 12, 0)));
  __resetCaseBars();
  loader.fail = false;
  loader.calls.length = 0;
  loader.anchor = ANCHOR;
  await bootFixtureJournal();
  calls.length = 0;
  setCloudEnabledForTests(true);
  resetCloudSession();
  resetSocial();
  useCloudSession.setState({ phase: "signedOut" });
  current = feed([mkCase()]);
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: string, init: RequestInit = {}) => {
      const url = new URL(input, "https://journal.test");
      const method = (init.method ?? "GET").toUpperCase();
      const body = init.body ? JSON.parse(String(init.body)) : null;
      calls.push({ method, path: url.pathname, body });
      const p = url.pathname;
      if (p === "/api/v1/social/groups") {
        const groups: GroupsResponse = { me: ME, groups: [{ id: GROUP_ID, kind: current.group.kind, name: "Morgenrunde", description: "", role: current.group.role, members: 2, openReviews: 0, createdAt: "2026-10-01T08:00:00Z" }], goals: [] };
        return Response.json(groups);
      }
      if (p.endsWith("/hypothesis") && method === "POST") {
        const b = body as { direction: HypothesisInfo["direction"]; confidence: number; reason: string };
        const mine: HypothesisInfo = { author: ME.pseudonym, authorId: USER.id, me: true, direction: b.direction, confidence: b.confidence, reason: b.reason, createdAt: new Date().toISOString() };
        current = { ...current, cases: current.cases!.map((c) => ({ ...c, mine, hypotheses: c.hypotheses + 1 })) };
        return Response.json({ hypothesis: mine }, { status: 201 });
      }
      if (p.endsWith("/cases") && method === "POST") return Response.json({ id: "abcdabcd-0000-4000-8000-0000000000c9" }, { status: 201 });
      if (p.startsWith("/api/v1/social/groups/")) return Response.json(current);
      if (p === "/api/v1/social/leaderboard") return Response.json({ metric: "expectancy", origin: "all", day: null, total: 0, rows: [], mine: null, community: [], me: ME, group: null });
      if (p === "/api/v1/social/share") return Response.json({ shares: [] });
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

async function openFeed(): Promise<HTMLElement> {
  wrap(<CommunityView />);
  signIn();
  return screen.findByTestId("case-feed", {}, { timeout: 15_000 });
}

describe("Chartfall: vor der Hypothese", () => {
  it("zeigt die Kerzen bis zur Ankerkerze – die Zukunft ist nicht im Bild und nicht in der Skala", async () => {
    const feedEl = await openFeed();
    const card = await within(feedEl).findByTestId("case-card");
    expect(card).toHaveAttribute("data-phase", "decide");
    expect(within(card).getByText("BTCUSDT · 4 Std")).toBeInTheDocument();
    expect(within(card).getByText("Hält die Box nach oben?")).toBeInTheDocument();
    expect(within(card).getByText("Wo steht der Kurs nach 12 Kerzen (4 Std)?")).toBeInTheDocument();
    const chart = await within(card).findByTestId("case-chart");
    expect(chart).toHaveAttribute("data-future", "hidden");
    // 90 candles, every one a wick + a body – and not one of the 12 after the anchor
    expect(chart.querySelectorAll("svg g > rect")).toHaveLength(90);
    expect(within(chart).getByTestId("case-hidden")).toHaveTextContent("12 Kerzen");
    // the price scale is made of the visible candles only: a flat market of 100 ± 1 – no +12 % on the axis
    expect(chart.textContent).toContain("101");
    expect(chart.textContent).not.toMatch(/11[0-9],|112/);
    expect(within(card).queryByTestId("case-result")).toBeNull();
    expect(within(card).getByTestId("case-form")).toBeInTheDocument();
    expect(within(card).getByText("Sie wird mit der Serverzeit gespeichert und lässt sich nicht mehr ändern oder löschen.")).toBeInTheDocument();
    // the window the exchange was asked for ends at the horizon, starts before the visible part (ATR warm-up)
    const asked = loader.calls[0]!;
    expect(asked.symbol).toBe("BTCUSDT");
    expect(asked.to).toBe(ANCHOR + 12 * H4);
    expect(asked.from).toBe(ANCHOR - (90 + 14) * H4);
  });

  it("verlangt Richtung und einen Grund; erst dann geht die Hypothese hinaus – einmal", async () => {
    const feedEl = await openFeed();
    const card = await within(feedEl).findByTestId("case-card");
    await within(card).findByTestId("case-form");
    fireEvent.click(within(card).getByTestId("case-commit"));
    expect(within(card).getByText("Mindestens 10 Zeichen.")).toBeInTheDocument();
    expect(calls.some((c) => c.path.endsWith("/hypothesis"))).toBe(false);
    fireEvent.click(within(card).getByRole("radio", { name: "Steigt" }));
    fireEvent.change(within(card).getByTestId("case-reason"), { target: { value: "kurz" } });
    fireEvent.click(within(card).getByTestId("case-commit"));
    expect(calls.some((c) => c.path.endsWith("/hypothesis"))).toBe(false);
    fireEvent.click(within(card).getByRole("radio", { name: "80 %" }));
    fireEvent.change(within(card).getByTestId("case-reason"), { target: { value: "Ausbruch über die Box mit Volumen" } });
    await act(async () => {
      fireEvent.click(within(card).getByTestId("case-commit"));
    });
    const post = calls.find((c) => c.path.endsWith("/hypothesis"))!;
    expect(post.body).toEqual({ direction: "up", confidence: 80, reason: "Ausbruch über die Box mit Volumen" });
    // stored: the card turns into the committed phase – the continuation and the verdict from the candles
    await waitFor(() => expect(screen.getByTestId("case-card")).toHaveAttribute("data-phase", "committed"));
    const done = screen.getByTestId("case-card");
    await waitFor(() => expect(within(done).getByTestId("case-chart")).toHaveAttribute("data-future", "shown"));
    expect(within(done).queryByTestId("case-form")).toBeNull();
    expect(within(done).getByTestId("case-outcome")).toHaveTextContent("+12,0 % zum Ankerkurs");
    expect(within(done).getByTestId("case-outcome")).toHaveTextContent("also: Steigt");
    expect(within(done).getByTestId("case-mine-result")).toHaveTextContent("Deine Hypothese: Steigt (80 %) – trifft zu.");
    expect(within(done).getByTestId("case-chart").querySelectorAll("svg g > rect")).toHaveLength(90 + 12);
    expect(within(done).getByText("Die Texte der anderen bleiben verdeckt, bis der Fall geschlossen ist.")).toBeInTheDocument();
    expect(within(done).getByTestId("case-mine")).toHaveTextContent("Ausbruch über die Box mit Volumen");
  });

  it("eine falsche Hypothese wird ehrlich als nicht zutreffend gezeigt", async () => {
    current = feed([mkCase({ mine: hyp({ me: true, author: ME.pseudonym, authorId: USER.id, direction: "down", confidence: 90 }), hypotheses: 1 })]);
    const feedEl = await openFeed();
    const card = await within(feedEl).findByTestId("case-card");
    expect(card).toHaveAttribute("data-phase", "committed");
    expect(await within(card).findByTestId("case-mine-result")).toHaveTextContent("Deine Hypothese: Fällt (90 %) – trifft nicht zu.");
  });

  it("solange die Strecke läuft, steht der Zeitpunkt des Ergebnisses da – kein Schätzen", async () => {
    vi.setSystemTime(new Date(ANCHOR + 3 * H4));
    current = feed([mkCase({ mine: hyp({ me: true, author: ME.pseudonym, authorId: USER.id }), hypotheses: 1 })]);
    const feedEl = await openFeed();
    const result = await within(feedEl).findByTestId("case-result");
    expect(result).toHaveAttribute("data-outcome", "pending");
    expect(result).toHaveTextContent("Der Verlauf ist erst nach");
    expect(within(result).queryByTestId("case-outcome")).toBeNull();
  });

  it("fehlen die Kerzen, steht der Grund da und ein Knopf zum erneuten Laden", async () => {
    loader.fail = true;
    const feedEl = await openFeed();
    const err = await within(feedEl).findByTestId("case-error");
    expect(err).toHaveTextContent("nicht erreichbar");
    expect(within(feedEl).queryByTestId("case-form")).toBeNull(); // no hypothesis on a picture that is not there
    loader.fail = false;
    fireEvent.click(within(err).getByRole("button", { name: "Erneut laden" }));
    expect(await within(feedEl).findByTestId("case-form")).toBeInTheDocument();
  });
});

describe("Chartfall: geschlossen", () => {
  it("zeigt alle Hypothesen mit Urteil, Zählung und der Verzögerung seit dem Anker", async () => {
    current = feed([
      mkCase({
        closed: true,
        hypotheses: 3,
        mine: hyp({ me: true, author: ME.pseudonym, authorId: USER.id, direction: "up", createdAt: new Date(ANCHOR + H4 + 1000).toISOString() }),
        revealed: [
          hyp({ author: "Ruhige Eule 81", direction: "down", confidence: 60, reason: "Ich erwarte einen Rücksetzer", createdAt: new Date(ANCHOR + H4 + 2000).toISOString() }),
          hyp({ author: "Wacher Fuchs 55", authorId: "33333333-3333-4333-8333-333333333333", direction: "up", confidence: 90, reason: "Trend ist intakt", createdAt: new Date(ANCHOR + 4 * H4).toISOString() }),
        ],
      }),
    ]);
    const feedEl = await openFeed();
    const others = await within(feedEl).findByTestId("case-others");
    const rows = await within(others).findAllByTestId("hypothesis-row");
    expect(rows).toHaveLength(3);
    expect(rows[0]).toHaveTextContent("Du · Stiller Falke 27");
    expect(rows[0]).toHaveTextContent("trifft zu");
    expect(rows[0]).toHaveTextContent("vor der nächsten Kerze");
    expect(rows[1]).toHaveTextContent("Ich erwarte einen Rücksetzer");
    expect(rows[1]).toHaveTextContent("trifft nicht zu");
    expect(rows[2]).toHaveTextContent("3 Kerzen nach dem Anker"); // written three full candles after the anchor closed: part of the course was visible
    expect(within(others).getByTestId("case-tally")).toHaveTextContent("3 Hypothesen: 2 steigt · 1 fällt · 0 seitwärts");
    expect(within(others).getByTestId("case-tally")).toHaveTextContent("2 von 3 trafen zu – zu wenig für eine Quote.");
    expect(screen.getByTestId("case-card")).toHaveAttribute("data-phase", "closed");
    expect(within(screen.getByTestId("case-card")).getByTestId("analysis-note")).toHaveTextContent("Keine professionelle Finanzberatung.");
  });

  it("niemand hat geschrieben: das steht da", async () => {
    current = feed([mkCase({ closed: true })]);
    const feedEl = await openFeed();
    expect(await within(feedEl).findByText("Niemand hat eine Hypothese abgegeben.")).toBeInTheDocument();
  });
});

describe("Chartfall: wer stellen darf", () => {
  it("Mentor-Gruppe: Schüler:innen beantworten, Mentoren stellen", async () => {
    current = feed([mkCase()], { kind: "mentor", role: "student" });
    const feedEl = await openFeed();
    expect(within(feedEl).queryByTestId("case-new")).toBeNull();
    expect(within(feedEl).getByText("In Mentor-Gruppen stellen Mentoren die Fälle.")).toBeInTheDocument();
    expect(await within(feedEl).findByTestId("case-form")).toBeInTheDocument(); // a student still answers
  });

  it("Mentor und normale Gruppe: der Knopf öffnet das Blatt für diese Gruppe", async () => {
    current = feed([], { kind: "mentor", role: "owner" });
    const feedEl = await openFeed();
    expect(within(feedEl).getByTestId("case-empty")).toBeInTheDocument();
    fireEvent.click(within(feedEl).getByTestId("case-new"));
    expect(await screen.findByTestId("case-sheet")).toBeInTheDocument();
  });
});

describe("Neuer Chartfall (Blatt)", () => {
  async function sheet(): Promise<HTMLElement> {
    current = feed([]);
    const feedEl = await openFeed();
    fireEvent.click(await within(feedEl).findByTestId("case-new"));
    return screen.findByTestId("case-sheet", {}, { timeout: 15_000 });
  }

  it("lädt die echten Kerzen als Vorschau und stellt den Fall erst, wenn es sie gibt", async () => {
    const s = await sheet();
    fireEvent.change(within(s).getByTestId("case-pair"), { target: { value: "ethusdt" } });
    const preview = within(s).getByTestId("case-preview");
    await waitFor(() => expect(within(preview).getByTestId("case-chart")).toHaveAttribute("data-future", "hidden"));
    expect(within(s).getByTestId("case-anchor")).toBeInTheDocument();
    expect(loader.calls.at(-1)!.symbol).toBe("ETHUSDT");
    await act(async () => {
      fireEvent.click(within(s).getByTestId("case-post"));
    });
    const post = calls.find((c) => c.method === "POST" && c.path.endsWith("/cases"))!;
    const body = post.body as { pair: string; interval: string; anchorMs: number; horizon: number; openHours: number; question: string };
    expect(body).toMatchObject({ pair: "ETHUSDT", interval: "4h", horizon: 12, openHours: 24 });
    expect(body.anchorMs % H4).toBe(0); // on the exchange's grid
    expect(body.anchorMs + H4).toBeLessThanOrEqual(Date.now()); // a closed candle
    expect(JSON.stringify(post.body)).not.toMatch(/size|pnl|notes|trade/i); // nothing of the journal
  });

  it("ein kaputtes Symbol: keine Vorschau, kein Posten", async () => {
    const s = await sheet();
    fireEvent.change(within(s).getByTestId("case-pair"), { target: { value: "BT" } });
    expect(within(s).getByTestId("case-post")).toBeDisabled();
    expect(within(s).queryByTestId("case-chart")).toBeNull();
  });

  it("liefert die Börse nichts, gibt es nichts zu posten", async () => {
    loader.fail = true;
    const s = await sheet();
    await waitFor(() => expect(within(s).getByTestId("case-preview")).toHaveTextContent("nicht erreichbar"));
    expect(within(s).getByTestId("case-post")).toBeDisabled();
  });
});
