import { useTransform, type MotionValue } from "motion/react";
import { tickerPrice } from "@/app/HeaderTicker";
import { n0, pct0, signed } from "@/lib/format";
import { priceMv } from "@/market";
import { useAccountView, useJournal } from "@/store/journalStore";

/** Journal figures shown by the shell (footer ticker, command navigation); recomputed on journal changes only. */
export interface ShellStats {
  trades: number;
  setups: number;
  rules: number;
  net: number;
  winRate: number | null;
  currency: string;
}

/** Pure: display strings of the shell figures (de-DE, `–` while unknown). */
export function shellStatTexts(s: ShellStats): { net: string; winRate: string; trades: string; setups: string; rules: string } {
  return { net: `${signed(s.net, 2)} ${s.currency}`, winRate: pct0(s.winRate), trades: n0(s.trades), setups: n0(s.setups), rules: n0(s.rules) };
}

export function useShellStats(): ShellStats {
  const view = useAccountView("all");
  const settings = useJournal((s) => s.settings);
  return {
    trades: view.list.length,
    setups: settings.setups.length,
    rules: settings.rules.length,
    net: view.g.net,
    winRate: view.g.winRate,
    currency: settings.currency,
  };
}

/** Live price label as a MotionValue (render as `<motion.span>{mv}</motion.span>`: text updates without React renders). */
export function useLivePriceText(): MotionValue<string> {
  return useTransform(priceMv, tickerPrice);
}
