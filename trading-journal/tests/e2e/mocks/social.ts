/**
 * In-process fake of the P12 community functions for e2e (additive to `mocks/supabase.ts`; register it AFTER
 * `mockSupabase` – Playwright runs the newest route first, other `/api/v1/*` paths fall back to the Supabase mock).
 *
 * Mirrors the wire contract of `src/social/contract.ts`: `/api/v1/social/groups[/*]`, `/social/invite/:code`,
 * `/social/leaderboard`, `/social/share[/:id]`, the public `/social/shared/:token` and `/api/v1/feedback`. The signed-in
 * user comes from the bearer token's `sub` (as the server reads it); other community members are seeded under
 * pseudonyms. Shared payloads are validated with the REAL strict schema, so a leak of a money field fails the test.
 * State lives in the test process (`MockSocial`).
 */
import type { Page, Route } from "@playwright/test";
import { CASE_INTERVAL_MS, CasePatchSchema, CreateCaseSchema, HypothesisSchema, parseSharePayload, type CaseInfo, type CommentInfo, type GoalInfo, type GroupDetail, type GroupKind, type GroupRole, type HypothesisInfo, type LeaderboardRow, type MemberFigures, type MentorGoalDraft, type ShareInfo, type ShareLevel, type SharePayload, type SharedTrade, type SocialMe } from "../../../src/social/contract";
import { shareTitle } from "../../../src/social/format";
import { isOriginFilter, RANK_ORDER, type OriginClass, type SocialMetric } from "../../../src/social/metrics";

export interface MockMember {
  id: string;
  pseudonym: string;
  role: GroupRole;
  shareLevel: ShareLevel;
  figures: MemberFigures | null;
}
export interface MockComment {
  id: string;
  authorId: string;
  body: string;
  mentions: string[];
  hidden: boolean;
  createdAt: string;
}
export interface MockReview {
  id: string;
  authorId: string;
  payload: SharedTrade;
  question: string;
  status: "open" | "done";
  reviewedBy: string | null;
  createdAt: string;
  comments: MockComment[];
}
export interface MockGroup {
  id: string;
  kind: GroupKind;
  name: string;
  description: string;
  ownerId: string;
  members: MockMember[];
  invites: { code: string; role: "mentor" | "member" | "student"; uses: number; maxUses: number; expiresAt: string }[];
  reviews: MockReview[];
  seats?: number;
  /** Chartfälle (F47) */
  cases?: MockCase[];
}
export interface MockHypothesis {
  userId: string;
  direction: HypothesisInfo["direction"];
  confidence: number;
  reason: string;
  createdAt: string;
}
export interface MockCase {
  id: string;
  authorId: string;
  pair: string;
  interval: CaseInfo["interval"];
  anchorMs: number;
  horizon: number;
  question: string;
  closesAt: string;
  closed: boolean;
  createdAt: string;
  hyps: MockHypothesis[];
}
export interface MockShare extends ShareInfo {
  ownerId: string;
  payload: SharePayload;
}
export interface MockGoal {
  id: string;
  groupId: string;
  mentorId: string;
  studentId: string;
  draft: MentorGoalDraft;
  status: "open" | "accepted" | "declined";
  createdAt: string;
}

export interface MockSocialOptions {
  /** Pseudonym of the signed-in user (default "Stiller Falke 27"). */
  pseudonym?: string;
  /** Ranking opt-in of the signed-in user up front. */
  optIn?: boolean;
  /** Groups up front (the signed-in user is added as described in each group's members). */
  groups?: MockGroup[];
  /** Other traders in the global ranking (default: 12 seeded). 0 = no ranking yet. */
  rankedOthers?: number;
  /** Community distribution available (k ≥ 10; default true). */
  distribution?: boolean;
  /** Figures of the signed-in user (null = not computed yet). */
  figures?: (MemberFigures & { eligible: boolean; rTrades: number }) | null;
}

export interface MockSocial {
  me: { id: string | null; pseudonym: string; optIn: boolean; figures: SocialMe["figures"] };
  groups: MockGroup[];
  shares: MockShare[];
  goals: MockGoal[];
  feedback: { kind: string; message: string; target?: { type: string; id: string }; user: string | null }[];
  calls: string[];
}

export const OTHER_NAMES = ["Kühner Luchs 14", "Ruhige Eule 81", "Wacher Fuchs 55", "Klare Möwe 33", "Flinker Otter 72", "Geduldige Robbe 18", "Scharfer Habicht 64", "Freie Lerche 29", "Zäher Dachs 47", "Mutiger Kranich 90", "Heller Biber 36", "Treue Elster 58", "Kühle Krähe 21", "Fester Specht 83"];

export const fig = (expectancyR: number, discipline: number, consistency: number, trades = 34, drawdownR = 3.2, origin: OriginClass = "api"): MemberFigures => ({ trades, expectancyR, winRate: 52, discipline, consistency, drawdownR, origin, computedAt: "2026-10-12T03:00:00Z" });

const claimsSub = (auth: string | undefined): string | null => {
  const part = (auth ?? "").replace(/^Bearer\s+/i, "").split(".")[1];
  if (!part) return null;
  try {
    const c = JSON.parse(Buffer.from(part.replace(/-/g, "+").replace(/_/g, "/"), "base64").toString("utf8")) as { sub?: string };
    return c.sub ?? null;
  } catch {
    return null;
  }
};

let seq = 0;
const uuid = () => {
  const n = String(++seq).padStart(12, "0");
  return `abcdabcd-0000-4000-8000-${n}`;
};

export async function mockSocial(page: Page, opts: MockSocialOptions = {}): Promise<MockSocial> {
  const mock: MockSocial = {
    me: { id: null, pseudonym: opts.pseudonym ?? "Stiller Falke 27", optIn: opts.optIn ?? false, figures: opts.figures === undefined ? { ...fig(0.42, 81, 64, 31), eligible: true, rTrades: 31 } : opts.figures },
    groups: opts.groups ?? [],
    shares: [],
    goals: [],
    feedback: [],
    calls: [],
  };
  const ORIGINS: OriginClass[] = ["api", "csv", "manual", "api"];
  const others = Array.from({ length: opts.rankedOthers ?? 12 }, (_, i) => ({ pseudonym: OTHER_NAMES[i % OTHER_NAMES.length]!, f: fig(Math.round((1.1 - i * 0.09) * 100) / 100, 92 - i * 3, 78 - i * 4, 22 + i * 3, Math.round((1.5 + i * 0.4) * 10) / 10, ORIGINS[i % ORIGINS.length]!) }));
  const now = () => new Date().toISOString();
  const send = (route: Route, status: number, body: unknown) => route.fulfill({ status, contentType: "application/json", body: JSON.stringify(body) });
  const err = (route: Route, status: number, code: string, message: string) => send(route, status, { error: { code, message } });
  const nameOf = (uid: string) => (uid === mock.me.id ? mock.me.pseudonym : (mock.groups.flatMap((g) => g.members).find((m) => m.id === uid)?.pseudonym ?? "Mitglied"));
  const meObj = (): SocialMe => ({ pseudonym: mock.me.pseudonym, optIn: mock.me.optIn, figures: mock.me.figures });
  const isManager = (r: GroupRole) => r === "owner" || r === "mentor";
  const visibleReview = (g: MockGroup, me: MockMember, r: MockReview) => g.kind !== "mentor" || r.authorId === me.id || isManager(me.role);

  const metricOf = (f: MemberFigures, m: SocialMetric) => (m === "expectancy" ? f.expectancyR : m === "discipline" ? f.discipline : m === "drawdown" ? f.drawdownR : f.consistency) ?? 0;
  const board = (metric: SocialMetric, groupId: string | null, uid: string, origin = "all") => {
    const entries: { name: string; value: number; trades: number; me: boolean; dd: number | null; origin: OriginClass | null }[] = [];
    if (groupId) {
      const g = mock.groups.find((x) => x.id === groupId)!;
      const me = g.members.find((m) => m.id === uid)!;
      for (const m of g.members) {
        if (g.kind === "mentor" && !isManager(me.role) && m.id !== uid && !isManager(m.role)) continue;
        const f = m.id === uid ? mock.me.figures : m.figures;
        if (m.shareLevel === "stats" && f) entries.push({ name: m.pseudonym, value: metricOf(f, metric), trades: f.trades, me: m.id === uid, dd: f.drawdownR ?? null, origin: f.origin ?? null });
      }
    } else {
      for (const o of others) entries.push({ name: o.pseudonym, value: metricOf(o.f, metric), trades: o.f.trades, me: false, dd: o.f.drawdownR ?? null, origin: o.f.origin ?? null });
      if (mock.me.optIn && mock.me.figures?.eligible) entries.push({ name: mock.me.pseudonym, value: metricOf(mock.me.figures, metric), trades: mock.me.figures.trades, me: true, dd: mock.me.figures.drawdownR ?? null, origin: mock.me.figures.origin ?? null });
    }
    const dir = RANK_ORDER[metric] === "low" ? -1 : 1;
    const kept = entries.filter((e) => groupId || origin === "all" || e.origin === origin);
    kept.sort((a, b) => dir * (b.value - a.value) || b.trades - a.trades);
    const rows: LeaderboardRow[] = kept.map((e, i) => ({ rank: i + 1, prevRank: groupId ? null : i === 0 ? 2 : i === 1 ? 1 : i + 1, pseudonym: e.name, value: e.value, trades: e.trades, drawdownR: e.dd, origin: e.origin, me: e.me }));
    const mineIdx = rows.findIndex((r) => r.me);
    return {
      metric,
      origin: (groupId ? "all" : origin) as "all",
      day: rows.length ? "2026-10-12" : null,
      total: rows.length,
      rows: rows.slice(0, 25),
      mine: mineIdx >= 25 ? rows[mineIdx]! : null,
      community:
        opts.distribution === false
          ? []
          : [
              { metric: "expectancy", n: 24, p10: -0.35, p25: -0.05, p50: 0.18, p75: 0.45, p90: 0.85, mean: 0.21 },
              { metric: "discipline", n: 24, p10: 41, p25: 55, p50: 68, p75: 80, p90: 90, mean: 66 },
              { metric: "consistency", n: 24, p10: 30, p25: 42, p50: 55, p75: 66, p90: 77, mean: 54 },
              { metric: "winrate", n: 24, p10: 38, p25: 44, p50: 50, p75: 56, p90: 61, mean: 50 },
              { metric: "drawdown", n: 24, p10: 1.2, p25: 2.1, p50: 3.4, p75: 5.2, p90: 8, mean: 3.9 },
            ],
      me: meObj(),
      group: groupId ? { id: groupId, name: mock.groups.find((x) => x.id === groupId)!.name } : null,
    };
  };

  const summary = (g: MockGroup, me: MockMember) => ({
    id: g.id,
    kind: g.kind,
    name: g.name,
    description: g.description,
    role: me.role,
    members: g.members.length,
    openReviews: g.reviews.filter((r) => r.status === "open" && visibleReview(g, me, r)).length,
    createdAt: "2026-10-01T08:00:00Z",
  });
  const detail = (g: MockGroup, me: MockMember): GroupDetail => {
    const visible = g.kind === "mentor" && !isManager(me.role) ? g.members.filter((m) => m.id === me.id || isManager(m.role)) : g.members;
    const memberList = visible.map((m) => {
      const f = m.id === me.id ? (mock.me.figures ? { ...mock.me.figures } : null) : m.figures;
      return { id: m.id, pseudonym: m.id === me.id ? mock.me.pseudonym : m.pseudonym, role: m.role, shareLevel: m.shareLevel, joinedAt: "2026-10-01T08:00:00Z", me: m.id === me.id, figures: m.shareLevel === "stats" && f ? { trades: f.trades, expectancyR: f.expectancyR, winRate: f.winRate, discipline: f.discipline, consistency: f.consistency, computedAt: f.computedAt } : null, ...(g.kind === "team" ? { seat: true } : {}) };
    });
    return {
      ...summary(g, me),
      ownerId: g.ownerId,
      shareLevel: me.shareLevel,
      memberList,
      invites: isManager(me.role) ? g.invites.map((i) => ({ ...i })) : [],
      averages: null,
      seats: g.kind === "team" && me.role === "owner" ? { seats: g.seats ?? 5, used: g.members.length } : null,
    };
  };
  const hypInfo = (h: MockHypothesis, uid: string): HypothesisInfo => ({ author: nameOf(h.userId), authorId: h.userId, me: h.userId === uid, direction: h.direction, confidence: h.confidence, reason: h.reason, createdAt: h.createdAt });
  const caseClosed = (c: MockCase) => c.closed || Date.parse(c.closesAt) <= Date.now();
  /** Chartfälle as the server sends them: the others' hypotheses only once the case is closed; mentor groups: students see mentors' + own. */
  const casesFor = (g: MockGroup, me: MockMember): CaseInfo[] =>
    (g.cases ?? []).map((c) => {
      const closed = caseClosed(c);
      const mine = c.hyps.find((h) => h.userId === me.id);
      const roleOf = (uid: string): GroupRole => g.members.find((m) => m.id === uid)?.role ?? "member";
      const others = closed ? c.hyps.filter((h) => h.userId !== me.id && (g.kind !== "mentor" || isManager(me.role) || isManager(roleOf(h.userId)))) : [];
      return { id: c.id, groupId: g.id, author: nameOf(c.authorId), authorId: c.authorId, me: c.authorId === me.id, pair: c.pair, interval: c.interval, anchorMs: c.anchorMs, horizon: c.horizon, question: c.question, closesAt: c.closesAt, closed, createdAt: c.createdAt, hypotheses: c.hyps.length, mine: mine ? hypInfo(mine, me.id) : null, revealed: others.map((h) => hypInfo(h, me.id)) };
    });
  const feed = (g: MockGroup, me: MockMember) => ({
    group: detail(g, me),
    cases: casesFor(g, me),
    reviews: g.reviews
      .filter((r) => visibleReview(g, me, r))
      .map((r) => ({
        id: r.id,
        groupId: g.id,
        author: nameOf(r.authorId),
        authorId: r.authorId,
        me: r.authorId === me.id,
        payload: r.payload,
        question: r.question,
        status: r.status,
        reviewedBy: r.reviewedBy ? nameOf(r.reviewedBy) : null,
        createdAt: r.createdAt,
        comments: r.comments
          .filter((c) => !c.hidden || c.authorId === me.id || isManager(me.role))
          .map((c): CommentInfo => ({ id: c.id, author: nameOf(c.authorId), authorId: c.authorId, me: c.authorId === me.id, body: c.body, mentionsMe: c.mentions.includes(me.id), hidden: c.hidden, createdAt: c.createdAt })),
      })),
  });
  const goalsFor = (uid: string): GoalInfo[] =>
    mock.goals
      .filter((g) => g.studentId === uid || g.mentorId === uid)
      .map((g) => ({ id: g.id, groupId: g.groupId, groupName: mock.groups.find((x) => x.id === g.groupId)?.name ?? "", mentor: nameOf(g.mentorId), student: nameOf(g.studentId), studentId: g.studentId, draft: g.draft, status: g.status, createdAt: g.createdAt, mine: g.studentId === uid }));

  await page.route(/\/api\/v1\/(social|feedback)/, async (route) => {
    const req = route.request();
    const url = new URL(req.url());
    const method = req.method();
    const path = url.pathname;
    mock.calls.push(`${method} ${path}${url.search}`);
    const body = (() => {
      try {
        return (req.postDataJSON() ?? {}) as Record<string, unknown>;
      } catch {
        return {} as Record<string, unknown>;
      }
    })();

    // public read (no login)
    const shared = /^\/api\/v1\/social\/shared\/([^/]+)$/.exec(path);
    if (shared) {
      const s = mock.shares.find((x) => x.token === shared[1] && !x.revoked && (!x.expiresAt || Date.parse(x.expiresAt) > Date.now()));
      if (!s) return err(route, 404, "share_not_found", "Dieser Link ist abgelaufen oder wurde zurückgezogen.");
      s.views++;
      return send(route, 200, { kind: s.kind, payload: s.payload, createdAt: s.createdAt, expiresAt: s.expiresAt, views: s.views });
    }
    const uid = claimsSub(req.headers()["authorization"]);
    if (path === "/api/v1/feedback") {
      const b = body as { kind: string; message: string; target?: { type: string; id: string } };
      if (b.kind === "report" && !uid) return err(route, 401, "unauthenticated", "Zum Melden bitte anmelden.");
      const dup = b.kind === "report" && mock.feedback.some((f) => f.kind === "report" && f.user === uid && f.target?.id === b.target?.id);
      if (!dup) mock.feedback.push({ kind: b.kind, message: b.message, target: b.target, user: uid });
      return send(route, 201, { ok: true, ...(dup ? { duplicate: true } : {}) });
    }
    if (!uid) return err(route, 401, "unauthenticated", "Bitte melde dich an.");
    mock.me.id = uid;
    const seg = path.replace(/^\/api\/v1\/social\//, "").split("/").filter(Boolean);

    if (seg[0] === "leaderboard") {
      if (method === "GET") {
        const metric = (url.searchParams.get("metric") ?? "expectancy") as SocialMetric;
        const group = url.searchParams.get("group");
        if (group && !mock.groups.some((g) => g.id === group && g.members.some((m) => m.id === uid))) return err(route, 404, "group_not_found", "Diese Gruppe gibt es nicht.");
        const origin = url.searchParams.get("origin") ?? "all";
        return send(route, 200, board(metric, group, uid, isOriginFilter(origin) ? origin : "all"));
      }
      if (body.action === "optIn") mock.me.optIn = body.on === true;
      if (body.action === "reroll") mock.me.pseudonym = mock.me.pseudonym === "Stiller Falke 27" ? "Klarer Wolf 63" : "Stiller Falke 27";
      return send(route, 200, { me: meObj() });
    }

    if (seg[0] === "share") {
      if (method === "GET") return send(route, 200, { shares: mock.shares.filter((s) => s.ownerId === uid).map(({ ownerId: _o, payload: _p, ...s }) => s) });
      if (method === "DELETE") {
        const s = mock.shares.find((x) => x.id === seg[1] && x.ownerId === uid && !x.revoked);
        if (!s) return err(route, 404, "share_not_found", "Diesen Link gibt es nicht (mehr).");
        s.revoked = true;
        return send(route, 200, { ok: true });
      }
      const payload = parseSharePayload(body.payload);
      if (!payload) return err(route, 422, "invalid_body", "Eingaben unvollständig oder ungültig.");
      const days = Number(body.expiresInDays ?? 30);
      const token = `tok${String(++seq).padStart(19, "x")}`.slice(0, 22);
      const s: MockShare = { id: uuid(), token, kind: payload.kind, title: shareTitle(payload), createdAt: now(), expiresAt: days > 0 ? new Date(Date.now() + days * 86_400_000).toISOString() : null, revoked: false, views: 0, ownerId: uid, payload };
      mock.shares.unshift(s);
      const { ownerId: _o, payload: _p, ...share } = s;
      return send(route, 201, { share });
    }

    if (seg[0] === "invite") {
      const code = (seg[1] ?? "").toUpperCase();
      const g = mock.groups.find((x) => x.invites.some((i) => i.code === code));
      const inv = g?.invites.find((i) => i.code === code);
      if (!g || !inv || inv.uses >= inv.maxUses) return err(route, 404, "invite_invalid", "Diese Einladung ist abgelaufen oder ungültig.");
      const member = g.members.some((m) => m.id === uid);
      if (method === "GET") return send(route, 200, { code, groupName: g.name, kind: g.kind, role: inv.role, members: g.members.length, member });
      if (!member) {
        if (g.kind === "team" && g.members.length >= (g.seats ?? 5)) return err(route, 409, "no_seats", "Alle Sitzplätze sind belegt. Erhöhe die Anzahl im Kundenportal.");
        g.members.push({ id: uid, pseudonym: mock.me.pseudonym, role: inv.role, shareLevel: body.shareLevel === "stats" ? "stats" : "none", figures: null });
        inv.uses++;
      }
      return send(route, 201, { group: summary(g, g.members.find((m) => m.id === uid)!) });
    }

    // groups
    if (seg.length === 1 && method === "GET") {
      const mine = mock.groups.filter((g) => g.members.some((m) => m.id === uid));
      return send(route, 200, { me: meObj(), groups: mine.map((g) => summary(g, g.members.find((m) => m.id === uid)!)), goals: goalsFor(uid) });
    }
    if (seg.length === 1 && method === "POST") {
      const kind = body.kind as GroupKind;
      if (kind === "team") return err(route, 402, "plan_required", "Ein Team braucht den Team-Tarif mit Sitzplätzen.");
      const g: MockGroup = { id: uuid(), kind, name: String(body.name), description: String(body.description ?? ""), ownerId: uid, members: [{ id: uid, pseudonym: mock.me.pseudonym, role: "owner", shareLevel: "none", figures: null }], invites: [], reviews: [] };
      mock.groups.push(g);
      return send(route, 201, { group: summary(g, g.members[0]!) });
    }
    const g = mock.groups.find((x) => x.id === seg[1]);
    const me = g?.members.find((m) => m.id === uid);
    if (!g || !me) return err(route, 404, "group_not_found", "Diese Gruppe gibt es nicht (mehr) – oder du bist kein Mitglied.");
    const rest = seg.slice(2);
    if (!rest.length && method === "GET") return send(route, 200, feed(g, me));
    if (!rest.length && method === "DELETE") {
      mock.groups.splice(mock.groups.indexOf(g), 1);
      return send(route, 200, { ok: true });
    }
    if (rest[0] === "invites" && method === "POST") {
      const inv = { code: `INV${String(++seq).padStart(7, "0")}`, role: body.role as "member", uses: 0, maxUses: 25, expiresAt: new Date(Date.now() + 14 * 86_400_000).toISOString() };
      g.invites.unshift(inv);
      return send(route, 201, { invite: inv });
    }
    if (rest[0] === "invites" && method === "DELETE") {
      g.invites = g.invites.filter((i) => i.code !== rest[1]);
      return send(route, 200, { ok: true });
    }
    if (rest[0] === "members") {
      const target = g.members.find((m) => m.id === rest[1]);
      if (!target) return err(route, 404, "member_not_found", "Dieses Mitglied gibt es in der Gruppe nicht.");
      if (method === "PATCH") {
        if (body.shareLevel) target.shareLevel = body.shareLevel as ShareLevel;
        if (body.role) target.role = body.role as GroupRole;
        return send(route, 200, { ok: true });
      }
      g.members.splice(g.members.indexOf(target), 1);
      g.reviews = g.reviews.filter((r) => r.authorId !== target.id);
      return send(route, 200, { ok: true, left: target.id === uid });
    }
    if (rest[0] === "reviews" && rest.length === 1) {
      const payload = parseSharePayload(body.payload);
      if (!payload || payload.kind !== "trade") return err(route, 422, "invalid_body", "Eingaben unvollständig oder ungültig.");
      const r: MockReview = { id: uuid(), authorId: uid, payload, question: String(body.question ?? ""), status: "open", reviewedBy: null, createdAt: now(), comments: [] };
      g.reviews.unshift(r);
      return send(route, 201, { id: r.id });
    }
    const review = rest[0] === "reviews" ? g.reviews.find((r) => r.id === rest[1]) : undefined;
    if (rest[0] === "reviews" && (!review || !visibleReview(g, me, review))) return err(route, 404, "review_not_found", "Dieses Review gibt es nicht (mehr).");
    if (review && rest.length === 2 && method === "PATCH") {
      review.status = body.status as "open" | "done";
      review.reviewedBy = review.status === "done" ? uid : null;
      return send(route, 200, { ok: true });
    }
    if (review && rest.length === 2 && method === "DELETE") {
      g.reviews.splice(g.reviews.indexOf(review), 1);
      return send(route, 200, { ok: true });
    }
    if (review && rest[2] === "comments" && method === "POST") {
      const text = String(body.body);
      const mentions = g.members.filter((m) => m.id !== uid && text.toLowerCase().includes(`@${(m.id === uid ? mock.me.pseudonym : m.pseudonym).toLowerCase()}`)).map((m) => m.id);
      const c: MockComment = { id: uuid(), authorId: uid, body: text, mentions, hidden: false, createdAt: now() };
      review.comments.push(c);
      return send(route, 201, { comment: { id: c.id, author: mock.me.pseudonym, authorId: uid, me: true, body: text, mentionsMe: false, hidden: false, createdAt: c.createdAt } });
    }
    if (review && rest[2] === "comments" && method === "DELETE") {
      review.comments = review.comments.filter((c) => c.id !== rest[3]);
      return send(route, 200, { ok: true });
    }
    // Chartfälle (F47): validated with the real strict schemas, the others' hypotheses hidden until the case is closed
    if (rest[0] === "cases" && rest.length === 1 && method === "POST") {
      if (g.kind === "mentor" && !isManager(me.role)) return err(route, 403, "not_manager", "Das dürfen nur Gruppen-Owner und Mentoren.");
      const parsed = CreateCaseSchema.safeParse(body);
      if (!parsed.success) return err(route, 422, "invalid_body", "Eingaben unvollständig oder ungültig.");
      const b = parsed.data;
      const iv = CASE_INTERVAL_MS[b.interval];
      if (b.anchorMs % iv !== 0 || b.anchorMs + iv > Date.now()) return err(route, 422, "anchor_not_closed", "Die letzte sichtbare Kerze muss schon geschlossen sein.");
      const c: MockCase = { id: uuid(), authorId: uid, pair: b.pair, interval: b.interval, anchorMs: b.anchorMs, horizon: b.horizon, question: b.question, closesAt: new Date(Date.now() + b.openHours * 3_600_000).toISOString(), closed: false, createdAt: now(), hyps: [] };
      (g.cases ??= []).unshift(c);
      return send(route, 201, { id: c.id });
    }
    const kase = rest[0] === "cases" ? g.cases?.find((c) => c.id === rest[1]) : undefined;
    if (rest[0] === "cases" && !kase) return err(route, 404, "case_not_found", "Diesen Chartfall gibt es nicht (mehr).");
    if (kase && rest[2] === "hypothesis" && method === "POST") {
      const parsed = HypothesisSchema.safeParse(body);
      if (!parsed.success) return err(route, 422, "invalid_body", "Eingaben unvollständig oder ungültig.");
      if (caseClosed(kase)) return err(route, 409, "case_closed", "Dieser Chartfall ist geschlossen – Hypothesen gehen nur vorher.");
      if (kase.hyps.some((h) => h.userId === uid)) return err(route, 409, "already_hypothesis", "Du hast schon eine Hypothese – sie lässt sich nicht ändern.");
      const h: MockHypothesis = { userId: uid, ...parsed.data, createdAt: now() };
      kase.hyps.push(h);
      return send(route, 201, { hypothesis: hypInfo(h, uid) });
    }
    if (kase && rest.length === 2 && method === "PATCH") {
      if (!CasePatchSchema.safeParse(body).success) return err(route, 422, "invalid_body", "Eingaben unvollständig oder ungültig.");
      if (kase.authorId !== uid && !isManager(me.role)) return err(route, 403, "not_allowed", "Das dürfen nur Autor:in und Mentoren.");
      kase.closed = true;
      return send(route, 200, { ok: true });
    }
    if (kase && rest.length === 2 && method === "DELETE") {
      if (kase.authorId !== uid && !isManager(me.role)) return err(route, 403, "not_allowed", "Das dürfen nur Autor:in und Mentoren.");
      g.cases = (g.cases ?? []).filter((c) => c !== kase);
      return send(route, 200, { ok: true });
    }
    if (rest[0] === "goals" && method === "POST") {
      const goal: MockGoal = { id: uuid(), groupId: g.id, mentorId: uid, studentId: String(body.studentId), draft: body.draft as MentorGoalDraft, status: "open", createdAt: now() };
      mock.goals.unshift(goal);
      return send(route, 201, { id: goal.id });
    }
    if (rest[0] === "goals" && method === "PATCH") {
      const goal = mock.goals.find((x) => x.id === rest[1] && x.studentId === uid && x.status === "open");
      if (!goal) return err(route, 404, "goal_not_found", "Dieses Ziel ist schon beantwortet oder nicht für dich.");
      goal.status = body.status as "accepted";
      return send(route, 200, { ok: true });
    }
    return err(route, 404, "not_found", "Nicht gefunden.");
  });
  return mock;
}

/** A redacted trade payload for seeded reviews. */
export function mockTradePayload(o: Partial<SharedTrade> = {}): SharedTrade {
  return { v: 1, kind: "trade", pair: "BTCUSDT", side: "long", timeframe: "4h", day: "2026-10-09", result: "loss", r: -1, movePct: -1.2, rr: 2.5, rating: 2, followedPlan: false, checklist: { done: 3, total: 5 }, ...o };
}
