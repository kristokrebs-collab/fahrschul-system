/**
 * P12 community UI: the honest state without cloud, the signed-out pitch, the signed-in page (own card, ranking with
 * podium + own row, opt-in, groups, feed with mentions, mentor desk), the share sheet (fields, details, no link without
 * cloud), the public SharedView (ok / gone / adopt a setup) and the store flows against a stubbed fetch.
 */
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { setCloudEnabledForTests } from "@/cloud/env";
import { resetCloudSession, useCloudSession } from "@/cloud/session";
import { MotionRoot } from "@/motion/MotionRoot";
import type { FeedResponse, GroupsResponse, LeaderboardResponse, SharedSetup, SharedTrade } from "@/social/contract";
import { openShare, resetSocial, setOptIn, useSocial } from "@/social/store";
import { SocialHost } from "@/social/ui";
import { useJournal } from "@/store/journalStore";
import { CommunityView, SharedView } from "@/views/community";
import { stripPos } from "@/views/community/DistributionStrip";
import { mentionParts } from "@/views/community/ReviewFeed";
import { bootFixtureJournal, installDomPolyfills } from "./views.overview.harness";

const USER = { id: "11111111-1111-4111-8111-111111111111", email: "t@example.com", aal: "aal1" as const, mfaEnrolled: false };
const ME = { pseudonym: "Stiller Falke 27", optIn: false, figures: { trades: 31, rTrades: 31, eligible: true, expectancyR: 0.42, winRate: 55, discipline: 81, consistency: 64, computedAt: "2026-10-12T03:00:00Z" } };
const TRADE: SharedTrade = { v: 1, kind: "trade", pair: "BTCUSDT", side: "long", timeframe: "4h", day: "2026-10-09", result: "loss", r: -1, movePct: -1.2, rr: 2.5, rating: 2, followedPlan: false, checklist: { done: 3, total: 5 } };
const GROUP_ID = "abcdabcd-0000-4000-8000-00000000a001";

const board = (o: Partial<LeaderboardResponse> = {}): LeaderboardResponse => ({
  metric: "expectancy",
  day: "2026-10-12",
  total: 5,
  rows: [
    { rank: 1, prevRank: 2, pseudonym: "Kühner Luchs 14", value: 1.1, trades: 22, me: false },
    { rank: 2, prevRank: 1, pseudonym: "Ruhige Eule 81", value: 1.01, trades: 25, me: false },
    { rank: 3, prevRank: 3, pseudonym: "Wacher Fuchs 55", value: 0.92, trades: 28, me: false },
    { rank: 4, prevRank: null, pseudonym: "Klare Möwe 33", value: 0.83, trades: 31, me: false },
    { rank: 5, prevRank: 6, pseudonym: "Stiller Falke 27", value: 0.42, trades: 31, me: true },
  ],
  mine: null,
  community: [{ metric: "expectancy", n: 24, p10: -0.35, p25: -0.05, p50: 0.18, p75: 0.45, p90: 0.85, mean: 0.21 }],
  me: ME,
  group: null,
  ...o,
});

const feed = (o: { kind?: "group" | "mentor"; role?: "owner" | "member" | "student" } = {}): FeedResponse => ({
  group: {
    id: GROUP_ID,
    kind: o.kind ?? "group",
    name: "Morgenrunde",
    description: "",
    role: o.role ?? "owner",
    members: 2,
    openReviews: 1,
    createdAt: "2026-10-01T08:00:00Z",
    ownerId: USER.id,
    shareLevel: "none",
    memberList: [
      { id: USER.id, pseudonym: "Stiller Falke 27", role: o.role ?? "owner", shareLevel: "none", joinedAt: "2026-10-01T08:00:00Z", me: true, figures: null },
      { id: "22222222-2222-4222-8222-222222222222", pseudonym: "Ruhige Eule 81", role: o.kind === "mentor" ? "student" : "member", shareLevel: "stats", joinedAt: "2026-10-02T08:00:00Z", me: false, figures: { trades: 34, expectancyR: 0.31, winRate: 52, discipline: 74, consistency: 58, computedAt: "2026-10-12T03:00:00Z" } },
    ],
    invites: [],
    averages: null,
    seats: null,
  },
  reviews: [
    {
      id: "abcdabcd-0000-4000-8000-00000000r001",
      groupId: GROUP_ID,
      author: "Ruhige Eule 81",
      authorId: "22222222-2222-4222-8222-222222222222",
      me: false,
      payload: TRADE,
      question: "Stop zu eng?",
      status: "open",
      reviewedBy: null,
      createdAt: "2026-10-11T18:00:00Z",
      comments: [{ id: "c1", author: "Stiller Falke 27", authorId: USER.id, me: true, body: "@Ruhige Eule 81 Stop unter das Tief.", mentionsMe: false, hidden: false, createdAt: "2026-10-11T19:00:00Z" }],
    },
  ],
});

let groups: GroupsResponse;
let feedResponse: FeedResponse;
let boardResponse: LeaderboardResponse;
const calls: { method: string; path: string; body: unknown }[] = [];

beforeAll(() => installDomPolyfills());

beforeEach(async () => {
  await bootFixtureJournal();
  localStorage.removeItem("tj2-cloud-privacy");
  calls.length = 0;
  groups = { me: ME, groups: [], goals: [] };
  feedResponse = feed();
  boardResponse = board();
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
      calls.push({ method, path: url.pathname, body });
      const p = url.pathname;
      if (p === "/api/v1/social/groups") return Response.json(groups);
      if (p.startsWith("/api/v1/social/groups/")) return Response.json(feedResponse);
      if (p === "/api/v1/social/leaderboard") {
        if (method === "POST") {
          boardResponse = { ...boardResponse, me: { ...ME, optIn: body.action === "optIn" ? body.on : ME.optIn } };
          return Response.json({ me: boardResponse.me });
        }
        return Response.json(boardResponse);
      }
      if (p === "/api/v1/social/share") return method === "POST" ? Response.json({ share: { id: "s1", token: "A".repeat(22), kind: "trade", title: "x", createdAt: "", expiresAt: null, revoked: false, views: 0 } }, { status: 201 }) : Response.json({ shares: [] });
      if (p.startsWith("/api/v1/social/shared/")) {
        const token = p.split("/").pop();
        if (token === "G".repeat(22)) return Response.json({ error: { code: "share_not_found", message: "Dieser Link ist abgelaufen oder wurde zurückgezogen." } }, { status: 404 });
        if (token === "S".repeat(22)) return Response.json({ kind: "setup", payload: SETUP, createdAt: "2026-10-10T08:00:00Z", expiresAt: null, views: 3 });
        return Response.json({ kind: "trade", payload: TRADE, createdAt: "2026-10-10T08:00:00Z", expiresAt: "2026-11-10T08:00:00Z", views: 1 });
      }
      return Response.json({ error: { code: "not_found", message: "Nicht gefunden." } }, { status: 404 });
    }),
  );
});

afterEach(() => {
  setCloudEnabledForTests(null);
  resetCloudSession();
  resetSocial();
  vi.unstubAllGlobals();
});

const SETUP: SharedSetup = { v: 1, kind: "setup", name: "Box-Breakout", desc: "Ausbruch aus der 4h-Box", account: "scalp", color: "#e5202e", checklist: ["Box bestätigt"], entryCriteria: ["Close über Box"], exitCriteria: [], risk: { riskPct: 1, maxLeverage: 5, minRR: 2, stop: "box" }, tags: [], markets: ["BTCUSDT"], tf: ["4h"], stats: null };

const wrap = (ui: React.ReactNode) => render(<MotionRoot>{ui}</MotionRoot>);
const signIn = () => act(() => useCloudSession.setState({ phase: "signedIn", user: USER }));

describe("CommunityView", () => {
  it("without cloud: h1 Community and the honest card – no ranking, no members", () => {
    setCloudEnabledForTests(false);
    wrap(<CommunityView />);
    expect(screen.getByRole("heading", { level: 1, name: "Community" })).toBeInTheDocument();
    expect(screen.getByTestId("community-no-cloud")).toHaveTextContent("Community braucht die Cloud");
    expect(within(screen.getByTestId("community-no-cloud")).getByText("Statistik ab 10 Tradern")).toBeInTheDocument();
    expect(screen.queryByTestId("leaderboard-card")).toBeNull();
    expect(calls).toHaveLength(0);
  });

  it("signed out: the pitch; Anmelden opens the login sheet", () => {
    wrap(<CommunityView />);
    expect(screen.getByTestId("community-signed-out")).toBeInTheDocument();
    fireEvent.click(screen.getByTestId("community-signin"));
    expect(useCloudSession.getState().sheet).toMatchObject({ open: true, view: "signin" });
    expect(calls).toHaveLength(0);
  });

  it("signed in: own card, percentile, podium, own row; the opt-in goes to the server", async () => {
    wrap(<CommunityView />);
    signIn();
    const you = await screen.findByTestId("you-card");
    await waitFor(() => expect(within(you).getByText("Stiller Falke 27")).toBeInTheDocument());
    const boardCard = screen.getByTestId("leaderboard-card");
    await waitFor(() => expect(within(boardCard).getByTestId("podium-1")).toHaveTextContent("Kühner Luchs 14"));
    expect(within(boardCard).getByTestId("podium-2")).toHaveTextContent("Ruhige Eule 81");
    const mine = boardCard.querySelector("[data-me]");
    expect(mine).toHaveTextContent("Du · Stiller Falke 27");
    // percentile of +0,42R in the distribution (between p50 0,18 and p75 0,45)
    await waitFor(() => expect(within(you).getByTestId("you-percentile")).toHaveTextContent("Besser als 72 % der Teilnehmer"));
    expect(screen.getByTestId("distribution-strip")).toBeInTheDocument();
    // not opted in → the join row; the switch posts the opt-in
    expect(within(boardCard).getByTestId("board-join")).toBeInTheDocument();
    await act(async () => {
      fireEvent.click(within(you).getByTestId("you-optin"));
    });
    await waitFor(() => expect(calls.some((c) => c.method === "POST" && c.path === "/api/v1/social/leaderboard" && (c.body as { action: string; on: boolean }).on === true)).toBe(true));
    await waitFor(() => expect(useSocial.getState().me?.optIn).toBe(true));
    expect(JSON.parse(localStorage.getItem("tj2-cloud-privacy") ?? "{}")).toMatchObject({ leaderboard: true });
  });

  it("groups: none yet → create / join; with a group: feed, mentions highlighted, members with shared figures only", async () => {
    wrap(<CommunityView />);
    signIn();
    await screen.findByTestId("groups-empty");
    fireEvent.click(screen.getByTestId("group-create"));
    expect(useSocial.getState().sheet).toEqual({ kind: "create" });
    await act(async () => {
      useSocial.setState({ sheet: null });
      groups = { me: ME, groups: [{ id: GROUP_ID, kind: "group", name: "Morgenrunde", description: "", role: "owner", members: 2, openReviews: 1, createdAt: "2026-10-01T08:00:00Z" }], goals: [] };
      const { loadCommunity } = await import("@/social/store");
      await loadCommunity();
    });
    const header = await screen.findByTestId("group-header");
    expect(header).toHaveTextContent("Morgenrunde");
    const review = screen.getByTestId("review-card");
    expect(review).toHaveTextContent("Stop zu eng?");
    expect(within(review).getByTestId("trade-share-card")).toBeInTheDocument();
    const mention = within(review).getByText("@Ruhige Eule 81", { selector: "span" });
    expect(mention.className).toMatch(/font-medium/);
    const rows = screen.getAllByTestId("member-row");
    expect(rows[0]).toHaveTextContent("teilt keine Kennzahlen");
    expect(rows[1]).toHaveTextContent("+0,31R");
    // the owner can manage the member: the disclosure reveals "Entfernen"
    fireEvent.click(within(rows[1]!).getByTestId("member-manage"));
    await waitFor(() => expect(within(rows[1]!).getByTestId("member-remove")).toBeInTheDocument());
  });

  it("mentor group: the desk deals the open reviews of students", async () => {
    groups = { me: ME, groups: [{ id: GROUP_ID, kind: "mentor", name: "Mentoring", description: "", role: "owner", members: 2, openReviews: 1, createdAt: "2026-10-01T08:00:00Z" }], goals: [] };
    feedResponse = feed({ kind: "mentor" });
    wrap(<CommunityView />);
    signIn();
    const desk = await screen.findByTestId("mentor-desk");
    await waitFor(() => expect(within(desk).getAllByTestId("queue-card")).toHaveLength(1));
    expect(within(desk).getByText("„Stop zu eng?“")).toBeInTheDocument();
    fireEvent.click(within(desk).getByTestId("goal-open"));
    expect(useSocial.getState().sheet).toEqual({ kind: "goal", groupId: GROUP_ID, studentId: "22222222-2222-4222-8222-222222222222" });
  });
});

describe("Share sheet", () => {
  it("lists exactly what would be shared; details are opt-in; no link without cloud, the picture always", async () => {
    setCloudEnabledForTests(false);
    wrap(<SocialHost />);
    const t = useJournal.getState().trades.find((x) => x.status === "closed")!;
    act(() => openShare({ kind: "trade", tradeId: t.id }));
    const sheet = await screen.findByRole("dialog", { name: "Teilen" });
    expect(within(sheet).getByText("Nie geteilt: Euro-Beträge, Kontogröße, Notizen, Börse.")).toBeInTheDocument();
    expect(within(sheet).queryByText("Einstieg, Ausstieg, Stop, Ziel")).toBeNull();
    fireEvent.click(within(sheet).getByTestId("share-opt-prices"));
    expect(within(sheet).getByText("Einstieg, Ausstieg, Stop, Ziel")).toBeInTheDocument();
    expect(within(sheet).getByText("Links brauchen ein Konto in der Cloud. Das Bild geht immer.")).toBeInTheDocument();
    expect(within(sheet).getByTestId("share-image")).toBeInTheDocument();
    expect(within(sheet).queryByTestId("share-create")).toBeNull();
  });

  it("signed in with cloud: creating a link posts the strictly redacted payload", async () => {
    signIn();
    wrap(<SocialHost />);
    const t = useJournal.getState().trades.find((x) => x.status === "closed")!;
    act(() => openShare({ kind: "trade", tradeId: t.id }));
    const sheet = await screen.findByRole("dialog", { name: "Teilen" });
    await act(async () => {
      fireEvent.click(within(sheet).getByTestId("share-create"));
    });
    await waitFor(() => expect(within(sheet).getByTestId("share-url")).toHaveValue(`${location.origin}/#share/${"A".repeat(22)}`));
    const post = calls.find((c) => c.method === "POST" && c.path === "/api/v1/social/share")!;
    const payload = (post.body as { payload: Record<string, unknown> }).payload;
    expect(payload.kind).toBe("trade");
    for (const k of ["pnl", "size", "fees", "notes", "reason", "account", "entry"]) expect(payload).not.toHaveProperty(k);
  });
});

describe("SharedView", () => {
  it("shows the redacted trade with views and expiry", async () => {
    wrap(<SharedView token={"T".repeat(22)} />);
    expect(await screen.findByTestId("trade-share-card")).toBeInTheDocument();
    expect(screen.getByTestId("shared-view")).toHaveAttribute("data-phase", "ok");
    expect(screen.getByText(/1× angesehen/)).toBeInTheDocument();
    expect(calls[0]!.path).toBe(`/api/v1/social/shared/${"T".repeat(22)}`);
  });

  it("an expired / revoked link says so honestly", async () => {
    wrap(<SharedView token={"G".repeat(22)} />);
    await waitFor(() => expect(screen.getByTestId("shared-view")).toHaveAttribute("data-phase", "gone"));
    expect(screen.getByText("Dieser Link ist abgelaufen oder wurde zurückgezogen.")).toBeInTheDocument();
  });

  it("a shared setup can be adopted as a new local Entscheidungsgrundlage", async () => {
    wrap(<SharedView token={"S".repeat(22)} />);
    expect(await screen.findByTestId("setup-share-card")).toHaveTextContent("Box-Breakout");
    const before = useJournal.getState().settings.setups.length;
    await act(async () => {
      fireEvent.click(screen.getByTestId("shared-adopt"));
    });
    await waitFor(() => expect(useJournal.getState().settings.setups).toHaveLength(before + 1));
    const added = useJournal.getState().settings.setups.at(-1)! as unknown as Record<string, unknown>;
    expect(added).toMatchObject({ name: "Box-Breakout", checklist: [expect.objectContaining({ text: "Box bestätigt" })], riskModel: { riskPct: 1, minRR: 2 }, markets: ["BTCUSDT"] });
    expect(added.examples).toBeUndefined();
  });

  it("without cloud in this build: honest notice, nothing fetched", () => {
    setCloudEnabledForTests(false);
    wrap(<SharedView token={"T".repeat(22)} />);
    expect(screen.getByTestId("shared-view")).toHaveAttribute("data-phase", "off");
    expect(calls).toHaveLength(0);
  });
});

describe("helpers", () => {
  it("mentionParts splits on whole pseudonyms", () => {
    expect(mentionParts("Danke @Ruhige Eule 81, gut! @Niemand", ["Ruhige Eule 81", "Stiller Falke 27"])).toEqual([
      { text: "Danke ", mention: false },
      { text: "@Ruhige Eule 81", mention: true },
      { text: ", gut! @Niemand", mention: false },
    ]);
  });

  it("stripPos clamps to the strip", () => {
    expect(stripPos(5, 0, 10)).toBe(50);
    expect(stripPos(-1, 0, 10)).toBe(0);
    expect(stripPos(11, 0, 10)).toBe(100);
    expect(stripPos(1, 1, 1)).toBe(50);
  });

  it("Konto → Datenschutz follows the server's ranking opt-in without a Community visit (P1-03)", async () => {
    const { PrivacyCard } = await import("@/cloud/ui/PrivacyCard");
    boardResponse = board({ me: { ...ME, optIn: true } });
    wrap(<PrivacyCard />);
    signIn();
    const sw = screen.getByRole("switch", { name: /In der Rangliste erscheinen/ });
    await waitFor(() => expect(sw).toBeChecked());
    expect(calls.some((c) => c.method === "GET" && c.path === "/api/v1/social/leaderboard")).toBe(true);
    // adopted silently: no POST back to the server
    expect(calls.some((c) => c.method === "POST")).toBe(false);
  });

  it("setOptIn without login does nothing", async () => {
    expect(await setOptIn(true)).toBe(false);
    expect(calls).toHaveLength(0);
  });
});
