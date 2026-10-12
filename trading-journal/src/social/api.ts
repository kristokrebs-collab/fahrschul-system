/**
 * `apiFetch` wrappers of the community functions (P12). Every call goes to the same-origin `/api/v1/social/*` /
 * `/api/v1/feedback` with the user's bearer token; errors arrive as `ApiError` with a German message.
 */
import { apiFetch } from "@/cloud/api";
import type {
  CommentInfo,
  CreateShareResponse,
  FeedbackRequest,
  FeedResponse,
  GroupKind,
  GroupSummary,
  GroupsResponse,
  InviteInfo,
  InvitePreview,
  LeaderboardAction,
  LeaderboardResponse,
  MentorGoalDraft,
  ShareInfo,
  ShareLevel,
  SharePayload,
  SharedResponse,
  SharedTrade,
  SocialMe,
} from "./contract";
import type { SocialMetric } from "./metrics";

const g = (id: string) => `/social/groups/${encodeURIComponent(id)}`;

export const fetchGroups = () => apiFetch<GroupsResponse>("/social/groups");
export const postGroup = (body: { kind: GroupKind; name: string; description?: string }) => apiFetch<{ group: GroupSummary }>("/social/groups", { method: "POST", body });
export const fetchFeed = (id: string) => apiFetch<FeedResponse>(g(id));
export const deleteGroupApi = (id: string) => apiFetch<{ ok: true }>(g(id), { method: "DELETE" });
export const postInvite = (id: string, body: { role: InviteInfo["role"]; maxUses?: number; days?: number }) => apiFetch<{ invite: InviteInfo }>(`${g(id)}/invites`, { method: "POST", body });
export const deleteInvite = (id: string, code: string) => apiFetch<{ ok: true }>(`${g(id)}/invites/${encodeURIComponent(code)}`, { method: "DELETE" });
export const patchMemberApi = (id: string, uid: string, body: { role?: "mentor" | "member" | "student"; shareLevel?: ShareLevel }) =>
  apiFetch<{ ok: true }>(`${g(id)}/members/${encodeURIComponent(uid)}`, { method: "PATCH", body });
export const deleteMember = (id: string, uid: string) => apiFetch<{ ok: true; left: boolean }>(`${g(id)}/members/${encodeURIComponent(uid)}`, { method: "DELETE" });
export const postReviewApi = (id: string, payload: SharedTrade, question: string) => apiFetch<{ id: string }>(`${g(id)}/reviews`, { method: "POST", body: { payload, question } });
export const patchReview = (id: string, rid: string, status: "open" | "done") => apiFetch<{ ok: true }>(`${g(id)}/reviews/${encodeURIComponent(rid)}`, { method: "PATCH", body: { status } });
export const deleteReviewApi = (id: string, rid: string) => apiFetch<{ ok: true }>(`${g(id)}/reviews/${encodeURIComponent(rid)}`, { method: "DELETE" });
export const postCommentApi = (id: string, rid: string, body: string) => apiFetch<{ comment: CommentInfo }>(`${g(id)}/reviews/${encodeURIComponent(rid)}/comments`, { method: "POST", body: { body } });
export const deleteCommentApi = (id: string, rid: string, cid: string) =>
  apiFetch<{ ok: true }>(`${g(id)}/reviews/${encodeURIComponent(rid)}/comments/${encodeURIComponent(cid)}`, { method: "DELETE" });
export const postGoal = (id: string, studentId: string, draft: MentorGoalDraft) => apiFetch<{ id: string }>(`${g(id)}/goals`, { method: "POST", body: { studentId, draft } });
export const patchGoal = (id: string, gid: string, status: "accepted" | "declined") => apiFetch<{ ok: true }>(`${g(id)}/goals/${encodeURIComponent(gid)}`, { method: "PATCH", body: { status } });
export const fetchInvite = (code: string) => apiFetch<InvitePreview>(`/social/invite/${encodeURIComponent(code)}`);
export const postJoin = (code: string, shareLevel: ShareLevel) => apiFetch<{ group: GroupSummary }>(`/social/invite/${encodeURIComponent(code)}`, { method: "POST", body: { shareLevel } });

export const fetchLeaderboard = (metric: SocialMetric, group?: string | null) => apiFetch<LeaderboardResponse>("/social/leaderboard", { query: { metric, group: group ?? undefined } });
export const postLeaderboard = (action: LeaderboardAction) => apiFetch<{ me: SocialMe }>("/social/leaderboard", { method: "POST", body: action });

export const fetchShares = () => apiFetch<{ shares: ShareInfo[] }>("/social/share");
export const postShare = (payload: SharePayload, expiresInDays: 0 | 1 | 7 | 30) => apiFetch<CreateShareResponse>("/social/share", { method: "POST", body: { payload, expiresInDays } });
export const deleteShare = (id: string) => apiFetch<{ ok: true }>(`/social/share/${encodeURIComponent(id)}`, { method: "DELETE" });
/** The public read – no token sent. */
export const fetchShared = (token: string) => apiFetch<SharedResponse>(`/social/shared/${encodeURIComponent(token)}`, { auth: false });

export const postFeedback = (body: FeedbackRequest) => apiFetch<{ ok: true; duplicate?: boolean; hidden?: boolean }>("/feedback", { method: "POST", body });
