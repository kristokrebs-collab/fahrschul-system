import { useTransform, type MotionValue } from "motion/react";
import { tickerPrice } from "@/app/HeaderTicker";
import { usePlan } from "@/billing/entitlements";
import { useBillingMode } from "@/billing/store";
import { cloudEnabled } from "@/cloud/env";
import { useCloudSession } from "@/cloud/session";
import { isoWeek } from "@/lib/dates";
import { n0, pct0, signed } from "@/lib/format";
import { priceMv } from "@/market";
import { useAccountView, useJournal } from "@/store/journalStore";
import { readJson, storageKey } from "@/store/storage";
import type { Page } from "@/store/uiStore";

/** Journal figures shown by the shell (footer ticker, command navigation); recomputed on journal changes only. */
export interface ShellStats {
  trades: number;
  setups: number;
  rules: number;
  net: number;
  winRate: number | null;
  currency: string;
  /** trades still open */
  open: number;
  /** trades carrying at least one mistake tag */
  mistakes: number;
  /** active growth goals (P08) */
  goals: number;
  /** the journal's market symbol (Markt page) */
  symbol: string;
}

/** Pure: display strings of the shell figures (de-DE, `–` while unknown). */
export function shellStatTexts(s: Pick<ShellStats, "trades" | "setups" | "rules" | "net" | "winRate" | "currency">): { net: string; winRate: string; trades: string; setups: string; rules: string } {
  return { net: `${signed(s.net, 2)} ${s.currency}`, winRate: pct0(s.winRate), trades: n0(s.trades), setups: n0(s.setups), rules: n0(s.rules) };
}

/**
 * Active growth goals (P08 `settings.growth.goals`, status `active` – absent counts as active, like `goalOf`). Counted
 * here instead of importing `@/domain/growth/goals`, which loads the journal store lazily on its own.
 */
export function activeGoalCount(settings: object): number {
  const growth = (settings as { growth?: { goals?: unknown } }).growth;
  const goals = Array.isArray(growth?.goals) ? (growth.goals as unknown[]) : [];
  return goals.filter((g) => typeof g === "object" && g !== null && (g as { status?: unknown }).status !== "done" && (g as { status?: unknown }).status !== "dropped").length;
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
    open: view.list.filter((t) => t.result === "open").length,
    mistakes: view.list.filter((t) => (t.mistakes ?? []).some((m) => typeof m === "string" && m.trim() !== "")).length,
    goals: activeGoalCount(settings),
    symbol: settings.market?.symbol ?? "",
  };
}

/** One count next to a page link (text + optional tone class). */
export interface PageCount {
  text: string;
  tone?: string;
}

/** What the shell knows beyond the journal for the page counts (cloud, plan, device-local stores). */
export interface PageCountEnv {
  /** cloud configured in this build (and not on claude.ai) */
  cloud: boolean;
  signedIn: boolean;
  /** effective plan name, `null` while billing is off */
  plan: string | null;
  /** stored backtest-lab runs (P07, this device) */
  labRuns: number;
  /** cockpit boards (P13, this device) */
  boards: number;
  /** "today" for the report week */
  now: Date;
}

const PLAN_NAME: Record<string, string> = { free: "Free", pro: "Pro", premium: "Premium", team: "Team" };

/**
 * Pure: the live count of every page in the command navigation – a figure that says what waits there (net P&L,
 * trades, setups, rules, the market symbol, the win rate, open positions, tagged mistakes, the report week, lab runs,
 * active goals, the cloud state, boards, the plan). Cheap: read when the panel opens, never per frame.
 */
export function pageCounts(s: ShellStats, env: PageCountEnv): Record<Page, PageCount> {
  const t = shellStatTexts(s);
  const w = isoWeek(env.now);
  return {
    overview: { text: t.net, tone: s.net > 0 ? "text-win" : s.net < 0 ? "text-loss" : "text-mute" },
    trades: { text: t.trades },
    setups: { text: t.setups },
    settings: { text: t.rules },
    // the TradingView symbol of the chart level (`BINANCE:BTCUSDT`) without its exchange prefix
    markt: { text: s.symbol.replace(/^[A-Z0-9_]+:/, "") || "–" },
    analyse: { text: t.winRate },
    risiko: { text: s.open ? `${n0(s.open)} offen` : "0", tone: s.open ? "text-warn" : undefined },
    coach: { text: n0(s.mistakes) },
    berichte: { text: `KW ${w.week}` },
    labor: { text: n0(env.labRuns) },
    wachstum: { text: n0(s.goals) },
    community: { text: env.cloud ? (env.signedIn ? "Cloud" : "–") : "lokal" },
    cockpit: { text: n0(env.boards) },
    konto: { text: env.cloud ? (env.signedIn ? "Cloud" : "lokal") : "lokal" },
    preise: { text: env.plan ?? "–" },
    // the register itself (`features.ts`) is a lazy chunk – the navigation does not load it for a number
    funktionen: { text: "Index" },
    studio: { text: "Text" },
    plan: { text: "5 Schritte" },
    aktien: { text: "Scan" },
  };
}

/** The counts for the open command navigation (`pageCounts` with the live cloud / plan state). */
export function usePageCounts(stats: ShellStats): Record<Page, PageCount> {
  const signedIn = useCloudSession((s) => s.phase === "signedIn");
  const mode = useBillingMode();
  const plan = usePlan();
  const labRuns = readJson<unknown[]>(storageKey("labor-runs"), []);
  const cockpit = readJson<{ boards?: unknown[] } | null>(storageKey("cockpit"), null);
  return pageCounts(stats, {
    cloud: cloudEnabled(),
    signedIn,
    plan: mode === "off" ? null : (PLAN_NAME[plan.plan] ?? plan.plan),
    labRuns: Array.isArray(labRuns) ? labRuns.length : 0,
    boards: Array.isArray(cockpit?.boards) ? cockpit.boards.length : 1,
    now: new Date(),
  });
}

/** Live price label as a MotionValue (render as `<motion.span>{mv}</motion.span>`: text updates without React renders). */
export function useLivePriceText(): MotionValue<string> {
  return useTransform(priceMv, tickerPrice);
}
