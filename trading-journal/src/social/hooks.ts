/**
 * React glue of the community (P12): boot / teardown with the session, the local figures preview, the percentile.
 */
import { useEffect, useMemo, useState } from "react";
import { useCloudSession } from "@/cloud/session";
import { useJournal } from "@/store/journalStore";
import type { CommunityDistribution } from "./contract";
import { clearInviteFromUrl, parseInvite } from "./links";
import { betterThanPct, metricValue, socialStats, type SocialMetric, type SocialStats } from "./metrics";
import { checkInvite, communityEnabled, loadBoard, loadCommunity, loadShares, resetSocial, useSocial } from "./store";

/** The trader's own R-based figures, computed on this device over the local journal (same code as the server). */
export function useLocalStats(): SocialStats {
  const trades = useJournal((s) => s.trades);
  const [now] = useState(() => Date.now());
  return useMemo(() => socialStats(trades, now), [trades, now]);
}

/**
 * Loads the community while signed in (groups, ranking, links) and clears it on sign-out. An invitation in the address
 * (`#community?invite=CODE`) is picked up once – checked as soon as the user is signed in.
 */
export function useCommunityBoot(): void {
  const phase = useCloudSession((s) => s.phase);
  const needsMfa = useCloudSession((s) => s.needsMfa);
  const uid = useCloudSession((s) => s.user?.id ?? null);
  const ready = communityEnabled() && phase === "signedIn" && !needsMfa && !!uid;

  // invitation from the URL (kept until handled; works before the login too)
  useEffect(() => {
    if (!communityEnabled()) return;
    const code = parseInvite(location.hash) ?? parseInvite(location.search);
    if (!code) return;
    clearInviteFromUrl();
    useSocial.setState({ invite: { code, preview: null, load: "idle", error: null } });
  }, []);

  useEffect(() => {
    if (!ready) {
      if (phase === "signedOut") resetSocial({ keepInvite: true });
      return;
    }
    void loadCommunity();
    void loadBoard();
    void loadShares();
    const pending = useSocial.getState().invite;
    if (pending && !pending.preview) void checkInvite(pending.code);
  }, [ready, uid, phase]);
}

/** Percentile (1–99) of `value` in the community distribution of `metric`, or null (no distribution / no value). */
export function percentileIn(dist: readonly CommunityDistribution[] | undefined, metric: SocialMetric, value: number | null): number | null {
  const d = dist?.find((x) => x.metric === metric);
  if (!d || value == null) return null;
  return betterThanPct(metric, value, d);
}

/** My value of a metric: the server's figures when present, else the local preview. */
export function myValue(metric: SocialMetric, server: { expectancyR: number | null; discipline: number | null; consistency: number | null; winRate: number | null; drawdownR?: number | null } | null, local: SocialStats): number | null {
  return metricValue(server ?? local, metric);
}
