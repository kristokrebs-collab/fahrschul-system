/** Pure rules of the management sheet (B4): the withdrawal period (§ 355 Abs. 2 BGB: 14 days from the conclusion of the contract). */
export const WITHDRAWAL_DAYS = 14;

/** Is the withdrawal period still running? `startedAt` = ISO time the contract was concluded; unknown → not offered here (the public page still is). */
export function withdrawalOpen(startedAt: string | null | undefined, now: number): boolean {
  if (!startedAt) return false;
  const t = Date.parse(startedAt);
  return Number.isFinite(t) && now >= t && now - t <= WITHDRAWAL_DAYS * 86_400_000;
}
