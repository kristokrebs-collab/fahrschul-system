/**
 * Paper accounts from the studio – the lab's forward test, nothing else: a virtual account that decides on NEW, closed
 * candles from now on (never backwards), with the costs of the lab. The studio builds no order, no exchange connection and no
 * path to real money. The rules are the saved version's (frozen copy); the account is remembered on the strategy
 * (`live`), so the studio can list it.
 */
import { sanitizeSignalCfg } from "@/domain/signals";
import { forwardOfSettings, type ForwardAccount } from "@/domain/forward";
import type { StoredStrategy, StudioVersion } from "@/domain/strategytext";
import { useJournal } from "@/store/journalStore";
import { startAccount } from "@/views/labor/forward/forwardActions";
import { useLabor } from "@/views/labor/laborStore";
import { resolveText } from "./resolve";
import { linkLive, strategiesNow } from "./studioWrites";

export type LiveResult = { ok: true; accountId: string } | { ok: false; error: string };

/** Starts a paper account for one version of a strategy. */
export async function startLive(st: StoredStrategy, v: StudioVersion, now: number = Date.now()): Promise<LiveResult> {
  const lab = useLabor.getState().cfg;
  const res = await startAccount(
    {
      name: `${st.name} v${v.n}`.slice(0, 60),
      config: v.config,
      signal: sanitizeSignalCfg(useJournal.getState().settings.signals),
      symbol: v.setup.symbol ?? st.symbol,
      capital: lab.capital,
      riskPct: v.setup.riskPct ?? lab.riskPct,
      maxLeverage: lab.maxLeverage,
      exchange: lab.exchange,
      slippage: lab.slippage,
      funding: lab.funding,
      source: { kind: "draft", label: st.name, versionNo: v.n },
    },
    now,
  );
  if (!res.ok) return res;
  await linkLive(st.id, { accountId: res.id, versionNo: v.n, at: now });
  return { ok: true, accountId: res.id };
}

export interface LiveAllResult {
  started: string[];
  /** strategies without a saved version */
  unsaved: string[];
  failed: { name: string; error: string }[];
}

/** One paper account per selected strategy (its newest saved version), one after the other so the limit of running accounts is respected. */
export async function startLiveAll(ids: readonly string[]): Promise<LiveAllResult> {
  const out: LiveAllResult = { started: [], unsaved: [], failed: [] };
  for (const st of strategiesNow().filter((s) => ids.includes(s.id))) {
    const v = st.versions[st.versions.length - 1];
    if (!v) {
      out.unsaved.push(st.name);
      continue;
    }
    // a version saved with an open question is a draft, not something to run
    const r = resolveText(v.text, v.answers, [v]);
    if (!r.ready) {
      out.failed.push({ name: st.name, error: r.why ?? "Die Regeln lassen sich noch nicht rechnen." });
      continue;
    }
    const res = await startLive(st, v);
    if (res.ok) out.started.push(st.name);
    else out.failed.push({ name: st.name, error: res.error });
  }
  return out;
}

/** The accounts of a strategy that still exist, newest first, with the version they were started from. */
export function accountsOf(st: StoredStrategy, accounts: readonly ForwardAccount[]): { link: StoredStrategy["live"][number]; account: ForwardAccount | null }[] {
  return st.live.map((link) => ({ link, account: accounts.find((a) => a.id === link.accountId) ?? null }));
}

export const accountsNowOf = (): ForwardAccount[] => forwardOfSettings(useJournal.getState().settings).accounts;
