/**
 * Community state of the client (P12) – a light zustand store that mirrors the server (`/api/v1/social/*`) and runs
 * the flows. Available only with a cloud (`communityEnabled()`) and a signed-in session; otherwise every action is a
 * no-op and the UI shows the honest state. The share sheet's local part (picture download) works in every build.
 *
 * Nothing here decides privacy: the server stores only what its strict schemas accept, and only the user's own
 * switches (ranking opt-in, share level per group, details per share) widen what leaves the journal.
 */
import { create } from "zustand";
import { ApiError, FUNCTIONS_MISSING } from "@/cloud/api";
import { cloudEnabled } from "@/cloud/env";
import { setPrivacy, usePrivacy } from "@/cloud/privacy";
import { useCloudSession } from "@/cloud/session";
import { addGoalFromDraft } from "@/domain/growth/goals";
import { hasClaudeRuntime } from "@/store/capability";
import { pushToast } from "@/store/uiStore";
import {
  closeCaseApi,
  deleteCaseApi,
  deleteCommentApi,
  deleteGroupApi,
  deleteInvite,
  deleteMember,
  deleteReviewApi,
  deleteShare,
  fetchFeed,
  fetchGroups,
  fetchInvite,
  fetchLeaderboard,
  fetchShares,
  patchGoal,
  patchMemberApi,
  patchReview,
  postCaseApi,
  postCommentApi,
  postHypothesisApi,
  postFeedback,
  postGoal,
  postGroup,
  postInvite,
  postJoin,
  postLeaderboard,
  postReviewApi,
  postShare,
} from "./api";
import type {
  CreateCaseRequest,
  FeedbackRequest,
  FeedResponse,
  GoalInfo,
  GroupKind,
  GroupSummary,
  InviteInfo,
  InvitePreview,
  LeaderboardResponse,
  HypothesisRequest,
  MentorGoalDraft,
  ShareInfo,
  ShareLevel,
  SharePayload,
  SharedTrade,
  SocialMe,
} from "./contract";
import type { OriginFilter, SocialMetric } from "./metrics";
import { CASES } from "./caseStrings";
import { S } from "./strings";

export interface UiError {
  code: string;
  message: string;
}

export type Load = "idle" | "loading" | "ready" | "error";

export interface Slot<T> {
  data: T | null;
  load: Load;
  error: UiError | null;
}

const EMPTY_SLOT = { data: null, load: "idle", error: null } as const;

/** The Community page's own sheets (mounted once at the page root – a sheet inside a card would take the card's
 * transform as its containing block). */
export type CommunitySheet = { kind: "create" } | { kind: "join" } | { kind: "pick" } | { kind: "goal"; groupId: string; studentId: string } | { kind: "proof" } | { kind: "case"; groupId: string };

/** What the share sheet shows (`openShare`). */
export type ShareTarget = { kind: "trade"; tradeId: string } | { kind: "setup"; setupId: string } | { kind: "stats" };

export interface SocialState {
  load: Load;
  error: UiError | null;
  me: SocialMe | null;
  groups: GroupSummary[];
  goals: GoalInfo[];
  activeGroup: string | null;
  feeds: Record<string, Slot<FeedResponse>>;
  boards: Record<string, Slot<LeaderboardResponse>>;
  metric: SocialMetric;
  /** The global ranking limited to traders whose records mostly came one way (`all` = everybody). */
  origin: OriginFilter;
  /** Rank the active group instead of everybody. */
  groupBoard: boolean;
  shares: Slot<ShareInfo[]>;
  /** A running action (button spinners). */
  busy: string | null;
  /** A pending invitation (from the URL or typed in). */
  invite: { code: string; preview: InvitePreview | null; load: Load; error: UiError | null } | null;
  /** What the share sheet shows (kept while it closes, so the exit animation keeps its content). */
  share: ShareTarget | null;
  shareOpen: boolean;
  /** The open page sheet (null = none). */
  sheet: CommunitySheet | null;
  /** Bumped per open – the sheet body remounts (fresh options) for every share. */
  shareSeq: number;
  /** Bumped on every new review / comment / share – replay keys for the effects. */
  pulse: number;
}

const INITIAL: SocialState = {
  load: "idle",
  error: null,
  me: null,
  groups: [],
  goals: [],
  activeGroup: null,
  feeds: {},
  boards: {},
  metric: "expectancy",
  origin: "all",
  groupBoard: false,
  shares: { ...EMPTY_SLOT },
  busy: null,
  invite: null,
  share: null,
  shareOpen: false,
  sheet: null,
  shareSeq: 0,
  pulse: 0,
};

export const useSocial = create<SocialState>()(() => ({ ...INITIAL }));

/** Sign-out / tests: back to the initial state. `keepInvite` keeps a pending invitation (it waits for the login). */
export function resetSocial(opts: { keepInvite?: boolean } = {}): void {
  const invite = opts.keepInvite ? useSocial.getState().invite : null;
  useSocial.setState({ ...INITIAL, feeds: {}, boards: {}, shares: { ...EMPTY_SLOT }, invite });
}

/** The build can talk to the community functions (cloud configured, not inside claude.ai). */
export function communityEnabled(): boolean {
  return cloudEnabled() && !hasClaudeRuntime();
}

const signedIn = (): boolean => {
  const s = useCloudSession.getState();
  return s.phase === "signedIn" && !!s.user && !s.needsMfa;
};

/** German UI error of anything an API call can throw. */
export function toUiError(e: unknown): UiError {
  if (e instanceof ApiError) {
    if (e.status === 0) return { code: "unavailable", message: e.message || FUNCTIONS_MISSING };
    return { code: e.code, message: e.message };
  }
  return { code: "error", message: e instanceof Error && e.message ? e.message : S.failed };
}

const boardKey = (metric: SocialMetric, group: string | null, origin: OriginFilter = "all") => `${metric}|${group ?? "all"}|${group ? "all" : origin}`;

/** Runs an action once at a time; toasts the error; resolves the result or null. */
async function act<T>(name: string, fn: () => Promise<T>, ok?: string | ((r: T) => string | null)): Promise<T | null> {
  if (!communityEnabled() || !signedIn()) return null;
  if (useSocial.getState().busy) return null;
  useSocial.setState({ busy: name });
  try {
    const r = await fn();
    const title = typeof ok === "function" ? ok(r) : ok;
    if (title) pushToast({ kind: "success", title });
    return r;
  } catch (e) {
    pushToast({ kind: "error", title: toUiError(e).message });
    return null;
  } finally {
    useSocial.setState({ busy: null });
  }
}

/* ------------------------------------------------------------------ load */

/** Groups, goals and my status; picks the first group when none is active. */
export async function loadCommunity(): Promise<void> {
  if (!communityEnabled() || !signedIn()) {
    useSocial.setState({ load: "idle", error: null });
    return;
  }
  useSocial.setState((s) => ({ load: s.me ? s.load : "loading" }));
  try {
    const r = await fetchGroups();
    useSocial.setState((s) => {
      const active = s.activeGroup && r.groups.some((g) => g.id === s.activeGroup) ? s.activeGroup : (r.groups[0]?.id ?? null);
      return { me: r.me, groups: r.groups, goals: r.goals, activeGroup: active, load: "ready", error: null };
    });
    syncOptIn(r.me);
    const active = useSocial.getState().activeGroup;
    if (active) void loadFeed(active);
  } catch (e) {
    useSocial.setState({ load: "error", error: toUiError(e) });
  }
}

/** The server's opt-in is the truth – the local switch (PrivacyCard) follows it silently. */
function syncOptIn(me: SocialMe): void {
  setPrivacy({ leaderboard: me.optIn }, { silent: true });
}

/**
 * Konto → Datenschutz shows the same ranking switch as Community (P1-03): on its mount (signed in) it asks the server
 * for my status and adopts the opt-in – without a Community visit first. A switch flipped while the answer is on its
 * way wins (the answer is dropped). Fills the board cache the Community page reuses.
 */
export async function followServerOptIn(): Promise<void> {
  if (!communityEnabled() || !signedIn()) return;
  const before = usePrivacy.getState().leaderboard;
  await loadBoard();
  const me = useSocial.getState().me;
  if (me && usePrivacy.getState().leaderboard === before) syncOptIn(me);
}

export async function loadFeed(groupId: string): Promise<void> {
  if (!communityEnabled() || !signedIn()) return;
  useSocial.setState((s) => ({ feeds: { ...s.feeds, [groupId]: { ...(s.feeds[groupId] ?? EMPTY_SLOT), load: s.feeds[groupId]?.data ? "ready" : "loading", error: null } } }));
  try {
    const data = await fetchFeed(groupId);
    useSocial.setState((s) => ({ feeds: { ...s.feeds, [groupId]: { data, load: "ready", error: null } } }));
  } catch (e) {
    const err = toUiError(e);
    useSocial.setState((s) => ({ feeds: { ...s.feeds, [groupId]: { data: s.feeds[groupId]?.data ?? null, load: "error", error: err } } }));
    // the group is gone (deleted / removed) → refresh the list
    if (err.code === "group_not_found") void loadCommunity();
  }
}

export function selectGroup(id: string): void {
  if (useSocial.getState().activeGroup === id) return;
  useSocial.setState({ activeGroup: id });
  void loadFeed(id);
  if (useSocial.getState().groupBoard) void loadBoard();
}

export async function loadBoard(metric: SocialMetric = useSocial.getState().metric): Promise<void> {
  if (!communityEnabled() || !signedIn()) return;
  const s0 = useSocial.getState();
  const group = s0.groupBoard ? s0.activeGroup : null;
  const origin = s0.origin;
  const key = boardKey(metric, group, origin);
  useSocial.setState((s) => ({ boards: { ...s.boards, [key]: { ...(s.boards[key] ?? EMPTY_SLOT), load: s.boards[key]?.data ? "ready" : "loading", error: null } } }));
  try {
    const data = await fetchLeaderboard(metric, group, origin);
    useSocial.setState((s) => ({ boards: { ...s.boards, [key]: { data, load: "ready", error: null } }, me: data.me }));
  } catch (e) {
    useSocial.setState((s) => ({ boards: { ...s.boards, [key]: { data: s.boards[key]?.data ?? null, load: "error", error: toUiError(e) } } }));
  }
}

export function setMetric(metric: SocialMetric): void {
  useSocial.setState({ metric });
  void loadBoard(metric);
}

export function setOrigin(origin: OriginFilter): void {
  useSocial.setState({ origin });
  void loadBoard();
}

export function setGroupBoard(on: boolean): void {
  useSocial.setState({ groupBoard: on });
  void loadBoard();
}

/** The board slot the UI shows right now. */
export function useBoard(): Slot<LeaderboardResponse> {
  return useSocial((s) => s.boards[boardKey(s.metric, s.groupBoard ? s.activeGroup : null, s.origin)] ?? EMPTY_SLOT);
}

export function useActiveFeed(): Slot<FeedResponse> {
  return useSocial((s) => (s.activeGroup ? (s.feeds[s.activeGroup] ?? EMPTY_SLOT) : EMPTY_SLOT));
}

/* ------------------------------------------------------------------ me: opt-in, refresh, pseudonym */

export async function setOptIn(on: boolean): Promise<boolean> {
  const r = await act("optIn", () => postLeaderboard({ action: "optIn", on }), on ? S.optedIn : S.optedOut);
  if (!r) return false;
  useSocial.setState({ me: r.me, boards: {} });
  syncOptIn(r.me);
  void loadBoard();
  return true;
}

export async function refreshMe(): Promise<void> {
  const r = await act("refresh", () => postLeaderboard({ action: "refresh" }), S.refreshed);
  if (r) useSocial.setState({ me: r.me });
}

export async function rerollPseudonym(): Promise<void> {
  const r = await act("reroll", () => postLeaderboard({ action: "reroll" }), (x) => S.rerolled(x.me.pseudonym));
  if (r) {
    useSocial.setState({ me: r.me, boards: {}, pulse: useSocial.getState().pulse + 1 });
    void loadBoard();
  }
}

/* ------------------------------------------------------------------ groups */

export async function createGroup(kind: GroupKind, name: string, description = ""): Promise<GroupSummary | null> {
  const r = await act("createGroup", () => postGroup({ kind, name, description }), S.groupCreated);
  if (!r) return null;
  useSocial.setState((s) => ({ groups: [...s.groups, r.group], activeGroup: r.group.id, pulse: s.pulse + 1 }));
  void loadFeed(r.group.id);
  return r.group;
}

export async function deleteGroup(id: string): Promise<boolean> {
  const r = await act("deleteGroup", () => deleteGroupApi(id), S.groupDeleted);
  if (!r) return false;
  dropGroup(id);
  return true;
}

function dropGroup(id: string): void {
  useSocial.setState((s) => {
    const groups = s.groups.filter((g) => g.id !== id);
    const feeds = { ...s.feeds };
    delete feeds[id];
    return { groups, feeds, activeGroup: s.activeGroup === id ? (groups[0]?.id ?? null) : s.activeGroup };
  });
  const next = useSocial.getState().activeGroup;
  if (next) void loadFeed(next);
}

export async function leaveGroup(id: string, me: string): Promise<boolean> {
  const r = await act("leave", () => deleteMember(id, me), S.left);
  if (!r) return false;
  dropGroup(id);
  return true;
}

export async function removeMember(groupId: string, memberId: string): Promise<void> {
  if (await act("remove", () => deleteMember(groupId, memberId), S.removed)) void loadFeed(groupId);
}

export async function setShareLevel(groupId: string, me: string, shareLevel: ShareLevel): Promise<void> {
  if (await act("shareLevel", () => patchMemberApi(groupId, me, { shareLevel }), shareLevel === "stats" ? S.sharingStats : S.notSharingStats)) {
    void loadFeed(groupId);
    if (shareLevel === "stats") void refreshMe();
  }
}

export async function setRole(groupId: string, memberId: string, role: "mentor" | "member" | "student"): Promise<void> {
  if (await act("role", () => patchMemberApi(groupId, memberId, { role }), S.roleChanged)) void loadFeed(groupId);
}

export async function createInvite(groupId: string, role: InviteInfo["role"]): Promise<InviteInfo | null> {
  const r = await act("invite", () => postInvite(groupId, { role }));
  if (!r) return null;
  void loadFeed(groupId);
  return r.invite;
}

export async function revokeInvite(groupId: string, code: string): Promise<void> {
  if (await act("revokeInvite", () => deleteInvite(groupId, code), S.inviteRevoked)) void loadFeed(groupId);
}

/** Looks up an invitation (from the URL or typed in) – stored in `invite` for the join sheet. */
export async function checkInvite(code: string): Promise<void> {
  const c = code.trim().toUpperCase();
  useSocial.setState({ invite: { code: c, preview: null, load: "loading", error: null } });
  if (!communityEnabled() || !signedIn()) {
    useSocial.setState({ invite: { code: c, preview: null, load: "idle", error: null } });
    return;
  }
  try {
    const preview = await fetchInvite(c);
    useSocial.setState({ invite: { code: c, preview, load: "ready", error: null } });
  } catch (e) {
    useSocial.setState({ invite: { code: c, preview: null, load: "error", error: toUiError(e) } });
  }
}

export function clearInvite(): void {
  useSocial.setState({ invite: null });
}

export async function joinGroup(code: string, shareLevel: ShareLevel): Promise<GroupSummary | null> {
  const r = await act("join", () => postJoin(code, shareLevel), (x) => S.joined(x.group.name));
  if (!r) return null;
  useSocial.setState({ invite: null, activeGroup: r.group.id, pulse: useSocial.getState().pulse + 1 });
  await loadCommunity();
  return r.group;
}

/* ------------------------------------------------------------------ reviews + comments */

export async function postReview(groupId: string, payload: SharedTrade, question: string): Promise<boolean> {
  const r = await act("review", () => postReviewApi(groupId, payload, question), S.reviewPosted);
  if (!r) return false;
  useSocial.setState((s) => ({ pulse: s.pulse + 1, activeGroup: groupId }));
  void loadFeed(groupId);
  return true;
}

export async function setReviewStatus(groupId: string, reviewId: string, status: "open" | "done"): Promise<void> {
  if (await act("reviewStatus", () => patchReview(groupId, reviewId, status), status === "done" ? S.reviewDone : S.reviewReopened)) void loadFeed(groupId);
}

export async function deleteReview(groupId: string, reviewId: string): Promise<void> {
  if (await act("reviewDelete", () => deleteReviewApi(groupId, reviewId), S.reviewDeleted)) void loadFeed(groupId);
}

export async function postComment(groupId: string, reviewId: string, body: string): Promise<boolean> {
  const r = await act("comment", () => postCommentApi(groupId, reviewId, body));
  if (!r) return false;
  useSocial.setState((s) => ({ pulse: s.pulse + 1 }));
  await loadFeed(groupId);
  return true;
}

export async function deleteComment(groupId: string, reviewId: string, commentId: string): Promise<void> {
  if (await act("commentDelete", () => deleteCommentApi(groupId, reviewId, commentId), S.commentDeleted)) void loadFeed(groupId);
}

/* ------------------------------------------------------------------ Chartfälle (F47) */

export async function postCase(groupId: string, body: CreateCaseRequest): Promise<boolean> {
  const r = await act("case", () => postCaseApi(groupId, body), CASES.posted);
  if (!r) return false;
  useSocial.setState((s) => ({ pulse: s.pulse + 1 }));
  void loadFeed(groupId);
  return true;
}

/** Writes the hypothesis once; the card then shows the continuation and the result. */
export async function postHypothesis(groupId: string, caseId: string, body: HypothesisRequest): Promise<boolean> {
  const r = await act("hypothesis", () => postHypothesisApi(groupId, caseId, body), CASES.committed);
  if (!r) return false;
  await loadFeed(groupId);
  return true;
}

export async function closeCase(groupId: string, caseId: string): Promise<void> {
  if (await act("caseClose", () => closeCaseApi(groupId, caseId), CASES.closed)) void loadFeed(groupId);
}

export async function deleteCase(groupId: string, caseId: string): Promise<void> {
  if (await act("caseDelete", () => deleteCaseApi(groupId, caseId), CASES.deleted)) void loadFeed(groupId);
}

/* ------------------------------------------------------------------ mentor goals */

export async function proposeGoal(groupId: string, studentId: string, draft: MentorGoalDraft): Promise<boolean> {
  const r = await act("goal", () => postGoal(groupId, studentId, draft), S.goalProposed);
  if (r) void loadCommunity();
  return !!r;
}

/** The student adopts a mentor goal: into the growth goals (P08), then the mentor sees "übernommen". */
export async function adoptGoal(goal: GoalInfo): Promise<boolean> {
  const r = await act("goalAnswer", async () => {
    const stored = await addGoalFromDraft({ ...goal.draft, source: { kind: "mentor", ref: goal.id, by: goal.mentor } });
    if (!stored) throw new Error(S.goalStoreFailed);
    await patchGoal(goal.groupId, goal.id, "accepted");
    return stored;
  }, S.goalAdopted);
  if (r) void loadCommunity();
  return !!r;
}

export async function declineGoal(goal: GoalInfo): Promise<void> {
  if (await act("goalAnswer", () => patchGoal(goal.groupId, goal.id, "declined"), S.goalDeclined)) void loadCommunity();
}

/* ------------------------------------------------------------------ shares */

export async function loadShares(): Promise<void> {
  if (!communityEnabled() || !signedIn()) return;
  useSocial.setState((s) => ({ shares: { ...s.shares, load: s.shares.data ? "ready" : "loading", error: null } }));
  try {
    const r = await fetchShares();
    useSocial.setState({ shares: { data: r.shares, load: "ready", error: null } });
  } catch (e) {
    useSocial.setState((s) => ({ shares: { data: s.shares.data, load: "error", error: toUiError(e) } }));
  }
}

export async function createShareLink(payload: SharePayload, days: 0 | 1 | 7 | 30): Promise<ShareInfo | null> {
  const r = await act("share", () => postShare(payload, days));
  if (!r) return null;
  useSocial.setState((s) => ({ shares: { data: [r.share, ...(s.shares.data ?? [])], load: "ready", error: null }, pulse: s.pulse + 1 }));
  return r.share;
}

export async function revokeShareLink(id: string): Promise<void> {
  if (await act("revokeShare", () => deleteShare(id), S.shareRevoked)) {
    useSocial.setState((s) => ({ shares: { ...s.shares, data: (s.shares.data ?? []).map((x) => (x.id === id ? { ...x, revoked: true } : x)) } }));
  }
}

export function openSheet(sheet: CommunitySheet): void {
  useSocial.setState({ sheet });
}

export function closeSheet(): void {
  useSocial.setState({ sheet: null });
}

export function openShare(target: ShareTarget): void {
  useSocial.setState((s) => ({ share: target, shareOpen: true, shareSeq: s.shareSeq + 1 }));
}

export function closeShare(): void {
  useSocial.setState({ shareOpen: false });
}

/* ------------------------------------------------------------------ feedback */

/** Sends feedback (also signed out, as long as the functions exist). Resolves true when stored. */
export async function sendFeedback(body: FeedbackRequest): Promise<boolean> {
  if (!communityEnabled()) return false;
  if (useSocial.getState().busy) return false;
  useSocial.setState({ busy: "feedback" });
  try {
    const r = await postFeedback(body);
    pushToast({ kind: "success", title: body.kind === "report" ? (r.duplicate ? S.reportedAgain : S.reported) : S.feedbackThanks });
    return true;
  } catch (e) {
    pushToast({ kind: "error", title: toUiError(e).message });
    return false;
  } finally {
    useSocial.setState({ busy: null });
  }
}
