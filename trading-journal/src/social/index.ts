/**
 * `@/social` – community client (P12). Light barrel: store, hooks, links, pure figures / redaction. The UI lives in
 * `@/social/ui` (share button / sheet / host) and `@/views/community` (Community page, public SharedView).
 */
export * from "./contract";
export * from "./metrics";
export { pseudonymFrom, monogramOf, matrixSafe, PSEUDONYM_RE } from "./pseudonym";
export { redactTrade, redactSetup, redactStats, sharedDetails, REDACT_DEFAULTS, type RedactOptions, type SetupFigures } from "./redact";
export { fmtR, fmtPct, fmtMove, metricText, metricMatrix, shareTitle, METRIC_LABEL, METRIC_HINT } from "./format";
export { shareUrl, inviteUrl, parseShareHash, parseInvite, clearInviteFromUrl, SHARE_ROUTE, INVITE_PARAM } from "./links";
export {
  useSocial,
  resetSocial,
  communityEnabled,
  toUiError,
  loadCommunity,
  loadFeed,
  loadBoard,
  loadShares,
  selectGroup,
  setMetric,
  setGroupBoard,
  useBoard,
  useActiveFeed,
  setOptIn,
  refreshMe,
  rerollPseudonym,
  createGroup,
  deleteGroup,
  leaveGroup,
  removeMember,
  setShareLevel,
  setRole,
  createInvite,
  revokeInvite,
  checkInvite,
  clearInvite,
  joinGroup,
  postReview,
  setReviewStatus,
  deleteReview,
  postComment,
  deleteComment,
  proposeGoal,
  adoptGoal,
  declineGoal,
  createShareLink,
  revokeShareLink,
  openShare,
  closeShare,
  openSheet,
  closeSheet,
  sendFeedback,
  type SocialState,
  type ShareTarget,
  type CommunitySheet,
  type Slot,
  type Load,
  type UiError,
} from "./store";
export { useLocalStats, useCommunityBoot, percentileIn, myValue } from "./hooks";
export { S, COMMUNITY, YOU, BOARD, GROUPS, FEED, MENTOR, SHARE, SHARED, FEEDBACK, MARQUEE, GROUP_KIND_LABEL, GROUP_KIND_HINT, ROLE_LABEL, SHARE_KIND_LABEL } from "./strings";
