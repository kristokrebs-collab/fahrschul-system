/**
 * The trader's OWN risk settings for the search's cards („Was machen wir wann?“, „Aktueller Kandidat“): the risk per trade counts only when the
 * trader saved it (`settings.risk.riskPerTradePct` exists only after a save that changed it) – never a default in its place; capital, fees,
 * slippage and leverage rule are his.
 */
import { useMemo } from "react";
import { riskLimits } from "@/domain/risk/config";
import type { AccountId } from "@/domain/types";
import { useJournal } from "@/store/journalStore";

export function useOwnRisk(acc: AccountId) {
  const settings = useJournal((s) => s.settings);
  const limits = useMemo(() => riskLimits(settings), [settings]);
  const riskPct = useMemo(() => {
    const r = (settings as { risk?: { riskPerTradePct?: unknown } }).risk;
    return typeof r?.riskPerTradePct === "number" && r.riskPerTradePct > 0 ? r.riskPerTradePct : null;
  }, [settings]);
  const capital = settings.capital?.[acc] ?? null;
  return { riskPct, capital, limits };
}

/** The account the search's cards start with: short candles → Scalp, otherwise Makro. */
export const defaultAccount = (interval: string | undefined): AccountId => (interval === "5m" || interval === "1h" ? "scalp" : "makro");
