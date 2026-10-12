/**
 * Wire contract of the community functions (P12) – PURE and alias-free: the Netlify functions import this file by
 * relative path and validate every body with these schemas; the client types its calls with them.
 *
 * Shared content is a REDACTED payload (`redact.ts` builds it on the device, the server re-validates it with the strict
 * schemas below – an unknown key is a 422, so nothing personal can be smuggled through): R and % only, never money,
 * account size, notes or the account's capital.
 */
import { z } from "zod";
import { SOCIAL_METRICS, type SocialMetric } from "./metrics";

/* ------------------------------------------------------------------ shared payloads */

const label = (max: number) => z.string().trim().min(1).max(max);
const num = (lo: number, hi: number) => z.number().finite().min(lo).max(hi);
const nullableNum = (lo: number, hi: number) => num(lo, hi).nullable();

/** A trade as it leaves the journal (v1). Every optional detail is only present when the owner switched it on. */
export const SharedTradeSchema = z
  .object({
    v: z.literal(1),
    kind: z.literal("trade"),
    pair: z.string().trim().min(1).max(24).regex(/^[A-Za-z0-9:._/-]+$/),
    side: z.enum(["long", "short"]),
    timeframe: z.string().trim().max(8).nullable(),
    /** Entry day `YYYY-MM-DD` (the time only with `time`). */
    day: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable(),
    time: z.string().regex(/^\d{2}:\d{2}$/).nullable().optional(),
    result: z.enum(["win", "loss", "be", "open"]),
    r: nullableNum(-100, 100),
    movePct: nullableNum(-1000, 1000),
    /** Planned reward-to-risk. */
    rr: nullableNum(0, 100),
    rating: z.number().int().min(1).max(5).nullable(),
    followedPlan: z.boolean().nullable(),
    checklist: z.object({ done: z.number().int().min(0).max(99), total: z.number().int().min(1).max(99) }).nullable(),
    // details (opt-in)
    holdMin: nullableNum(0, 525_600).optional(),
    maeR: nullableNum(0, 100).optional(),
    mfeR: nullableNum(0, 100).optional(),
    entry: nullableNum(0, 1e9).optional(),
    exit: nullableNum(0, 1e9).optional(),
    stop: nullableNum(0, 1e9).optional(),
    target: nullableNum(0, 1e9).optional(),
    leverage: nullableNum(0, 1000).optional(),
    setups: z.array(label(40)).max(5).optional(),
    tags: z.array(label(24)).max(8).optional(),
    mistakes: z.array(label(40)).max(8).optional(),
    emotion: z.string().trim().max(24).optional(),
  })
  .strict();
export type SharedTrade = z.infer<typeof SharedTradeSchema>;

const riskSchema = z
  .object({
    riskPct: nullableNum(0.01, 100),
    maxLeverage: nullableNum(1, 200),
    minRR: nullableNum(0.1, 50),
    stop: z.enum(["box", "struktur", "atr", "fix"]).nullable(),
  })
  .strict();

/** R-based figures (a setup's playbook or a trader's 90 days). */
export const SharedFiguresSchema = z
  .object({
    trades: z.number().int().min(0).max(100_000),
    winRate: nullableNum(0, 100),
    expectancyR: nullableNum(-100, 100),
  })
  .strict();

/** An Entscheidungsgrundlage (SetupX) without personal data: no example trade ids, no money (v1). */
export const SharedSetupSchema = z
  .object({
    v: z.literal(1),
    kind: z.literal("setup"),
    name: label(40),
    desc: z.string().trim().max(500),
    account: z.enum(["makro", "scalp", "both"]),
    color: z.string().regex(/^#[0-9a-fA-F]{6}$/),
    checklist: z.array(label(120)).max(30),
    entryCriteria: z.array(label(160)).max(30),
    exitCriteria: z.array(label(160)).max(30),
    risk: riskSchema.nullable(),
    tags: z.array(label(40)).max(20),
    markets: z.array(z.string().regex(/^[A-Z0-9]{2,20}$/)).max(20),
    tf: z.array(label(8)).max(12),
    stats: SharedFiguresSchema.nullable(),
  })
  .strict();
export type SharedSetup = z.infer<typeof SharedSetupSchema>;

/** A trader's 90-day figures as a card (v1). */
export const SharedStatsSchema = z
  .object({
    v: z.literal(1),
    kind: z.literal("stats"),
    windowDays: z.number().int().min(7).max(366),
    trades: z.number().int().min(0).max(100_000),
    expectancyR: nullableNum(-100, 100),
    winRate: nullableNum(0, 100),
    discipline: nullableNum(0, 100),
    consistency: nullableNum(0, 100),
  })
  .strict();
export type SharedStats = z.infer<typeof SharedStatsSchema>;

export const SharePayloadSchema = z.discriminatedUnion("kind", [SharedTradeSchema, SharedSetupSchema, SharedStatsSchema]);
export type SharePayload = z.infer<typeof SharePayloadSchema>;
export type ShareKind = SharePayload["kind"];

/** Strictly validated payload, or `null`. */
export function parseSharePayload(raw: unknown): SharePayload | null {
  const r = SharePayloadSchema.safeParse(raw);
  return r.success ? r.data : null;
}

/* ------------------------------------------------------------------ requests */

export const SHARE_EXPIRY_DAYS = [1, 7, 30, 0] as const; // 0 = no expiry

export const CreateShareSchema = z
  .object({
    payload: SharePayloadSchema,
    /** 0 = until revoked. */
    expiresInDays: z.union([z.literal(1), z.literal(7), z.literal(30), z.literal(0)]).default(30),
  })
  .strict();
export type CreateShareRequest = z.input<typeof CreateShareSchema>;

export const GROUP_KINDS = ["group", "mentor", "team"] as const;
export type GroupKind = (typeof GROUP_KINDS)[number];
export const GROUP_ROLES = ["owner", "mentor", "member", "student"] as const;
export type GroupRole = (typeof GROUP_ROLES)[number];
export const SHARE_LEVELS = ["none", "stats"] as const;
export type ShareLevel = (typeof SHARE_LEVELS)[number];

export const CreateGroupSchema = z
  .object({
    kind: z.enum(GROUP_KINDS),
    name: z.string().trim().min(2).max(40),
    description: z.string().trim().max(280).default(""),
  })
  .strict();

export const InviteSchema = z
  .object({
    role: z.enum(["mentor", "member", "student"]),
    maxUses: z.number().int().min(1).max(500).default(25),
    days: z.number().int().min(1).max(30).default(14),
  })
  .strict();

export const JoinSchema = z.object({ code: z.string().trim().toUpperCase().regex(/^[A-Z0-9]{10}$/), shareLevel: z.enum(SHARE_LEVELS).default("none") }).strict();

export const MemberPatchSchema = z
  .object({
    role: z.enum(["mentor", "member", "student"]).optional(),
    shareLevel: z.enum(SHARE_LEVELS).optional(),
  })
  .strict()
  .refine((b) => b.role !== undefined || b.shareLevel !== undefined, { message: "empty" });

export const ReviewSchema = z.object({ payload: SharedTradeSchema, question: z.string().trim().max(500).default("") }).strict();
export const ReviewPatchSchema = z.object({ status: z.enum(["open", "done"]) }).strict();
export const CommentSchema = z.object({ body: z.string().trim().min(1).max(1000) }).strict();

export const GOAL_METRICS = ["journalRate", "planAdherence", "checklistRate", "ruleBreaks", "tradesPerDay", "expectancyR", "winRate", "netR", "custom"] as const;
/** A mentor's goal proposal – the subset of P08's `GoalDraft` a mentor may set (no account scope, no personal data). */
export const GoalDraftSchema = z
  .object({
    title: z.string().trim().min(3).max(80),
    kind: z.enum(["process", "outcome", "limit"]),
    metric: z.enum(GOAL_METRICS),
    target: num(-1000, 1000),
    comparator: z.enum(["atLeast", "atMost"]),
    period: z.enum(["day", "week", "month", "quarter", "year"]),
    due: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
    why: z.string().trim().max(240).optional(),
  })
  .strict();
export type MentorGoalDraft = z.infer<typeof GoalDraftSchema>;
export const GoalSchema = z.object({ studentId: z.string().uuid(), draft: GoalDraftSchema }).strict();
export const GoalPatchSchema = z.object({ status: z.enum(["accepted", "declined"]) }).strict();

export const FEEDBACK_KINDS = ["bug", "idea", "praise", "report", "other"] as const;
export type FeedbackKind = (typeof FEEDBACK_KINDS)[number];
export const REPORT_TARGETS = ["comment", "review", "share", "group"] as const;
export const FeedbackSchema = z
  .object({
    kind: z.enum(FEEDBACK_KINDS),
    message: z.string().trim().min(3).max(2000),
    page: z.string().regex(/^[a-z0-9_-]{1,32}$/).optional(),
    target: z.object({ type: z.enum(REPORT_TARGETS), id: z.string().trim().min(1).max(64) }).strict().optional(),
    meta: z.object({ release: z.string().max(64).optional(), edition: z.enum(["personal", "share"]).optional() }).strict().optional(),
  })
  .strict()
  .refine((b) => b.kind !== "report" || !!b.target, { message: "target required", path: ["target"] });
export type FeedbackRequest = z.input<typeof FeedbackSchema>;

export const LeaderboardActionSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("optIn"), on: z.boolean() }).strict(),
  z.object({ action: z.literal("refresh") }).strict(),
  z.object({ action: z.literal("reroll") }).strict(),
]);
export type LeaderboardAction = z.infer<typeof LeaderboardActionSchema>;

/* ------------------------------------------------------------------ responses */

export interface ShareInfo {
  id: string;
  token: string;
  kind: ShareKind;
  /** Short label ("BTCUSDT Long · +2,1R", "Setup Breakout"). */
  title: string;
  createdAt: string;
  expiresAt: string | null;
  revoked: boolean;
  views: number;
}

export interface CreateShareResponse {
  share: ShareInfo;
}

export interface SharedResponse {
  kind: ShareKind;
  payload: SharePayload;
  createdAt: string;
  expiresAt: string | null;
  views: number;
}

/** R-based figures of one member as the group may see them (`share_level = 'stats'`). */
export interface MemberFigures {
  trades: number;
  expectancyR: number | null;
  winRate: number | null;
  discipline: number | null;
  consistency: number | null;
  computedAt: string;
}

export interface MemberInfo {
  /** Opaque member id (the user's id – needed for roles, seats, goals, mentions). */
  id: string;
  pseudonym: string;
  role: GroupRole;
  shareLevel: ShareLevel;
  joinedAt: string;
  me: boolean;
  /** Only when the member shares stats with the group. */
  figures: MemberFigures | null;
  /** Team groups: the member holds one of the owner's seats. */
  seat?: boolean;
}

export interface InviteInfo {
  code: string;
  role: "mentor" | "member" | "student";
  uses: number;
  maxUses: number;
  expiresAt: string;
}

export interface GroupSummary {
  id: string;
  kind: GroupKind;
  name: string;
  description: string;
  role: GroupRole;
  members: number;
  /** Open reviews visible to me. */
  openReviews: number;
  createdAt: string;
}

export interface GroupAverages {
  n: number;
  expectancyR: number | null;
  discipline: number | null;
  consistency: number | null;
}

export interface GroupDetail extends GroupSummary {
  ownerId: string;
  shareLevel: ShareLevel;
  memberList: MemberInfo[];
  /** Owners / mentors only. */
  invites: InviteInfo[];
  /** Averages of the members who share stats – only from `K_ANON` such members on (k-anonymity). */
  averages: GroupAverages | null;
  /** Team groups (owner only): the Team plan's seats. */
  seats: { seats: number; used: number } | null;
}

export interface CommentInfo {
  id: string;
  author: string;
  authorId: string;
  me: boolean;
  body: string;
  mentionsMe: boolean;
  hidden: boolean;
  createdAt: string;
}

export interface ReviewInfo {
  id: string;
  groupId: string;
  author: string;
  authorId: string;
  me: boolean;
  payload: SharedTrade;
  question: string;
  status: "open" | "done";
  reviewedBy: string | null;
  createdAt: string;
  comments: CommentInfo[];
}

export interface GoalInfo {
  id: string;
  groupId: string;
  groupName: string;
  mentor: string;
  student: string;
  studentId: string;
  draft: MentorGoalDraft;
  status: "open" | "accepted" | "declined";
  createdAt: string;
  /** I am the student (adopt / decline) – else I am the mentor. */
  mine: boolean;
}

export interface SocialMe {
  pseudonym: string;
  /** Ranking opt-in as the server sees it (`profiles.privacy.leaderboard`). */
  optIn: boolean;
  /** Last figures (null until computed). */
  figures: (MemberFigures & { eligible: boolean; rTrades: number }) | null;
}

export interface GroupsResponse {
  me: SocialMe;
  groups: GroupSummary[];
  goals: GoalInfo[];
}

export interface FeedResponse {
  group: GroupDetail;
  reviews: ReviewInfo[];
}

export interface InvitePreview {
  code: string;
  groupName: string;
  kind: GroupKind;
  role: "mentor" | "member" | "student";
  members: number;
  /** Already a member (the join is a no-op). */
  member: boolean;
}

export interface LeaderboardRow {
  rank: number;
  /** Rank of the previous snapshot (null = new). */
  prevRank: number | null;
  pseudonym: string;
  value: number;
  trades: number;
  me: boolean;
}

export interface CommunityDistribution {
  metric: SocialMetric | "winrate";
  n: number;
  p10: number;
  p25: number;
  p50: number;
  p75: number;
  p90: number;
  mean: number;
}

export interface LeaderboardResponse {
  metric: SocialMetric;
  /** Day of the snapshot (null = none yet). */
  day: string | null;
  /** Participants of the snapshot. */
  total: number;
  rows: LeaderboardRow[];
  /** My row when I am ranked outside the top rows. */
  mine: LeaderboardRow | null;
  /** Distributions per metric (k-anonymous, empty below k). */
  community: CommunityDistribution[];
  me: SocialMe;
  /** Group leaderboard: the group's name. */
  group: { id: string; name: string } | null;
}

export const LEADERBOARD_METRICS: readonly SocialMetric[] = SOCIAL_METRICS;
