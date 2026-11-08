/**
 * The Showroom's demo journal (Paket S): about 40 INVENTED trades over the last six weeks, in the legacy `tj2-*` record shape the e2e suite's
 * seed uses (the app migrates it at boot, the sync engine normalises it before it compares – so the same objects serve the device's journal AND
 * the rows of the demo account, and a sign-in finds nothing to ask about). Pure: the clock comes in as an argument, the "randomness" is a
 * fixed generator, so the same day gives the same journal.
 *
 * Built so the pages that need history have something to show: reports and the weekly close (trades in the current week), the risk page
 * (today's two losses use most of the daily limit: the limit hint turns up), growth / coach (a few trades against the plan, a revenge-like
 * pair), a mix of two accounts and four setups. Every record says "Demo-Eintrag" in its notes. NONE of it is a real trade.
 */

export interface DemoSetup {
  id: string;
  name: string;
  account: "makro" | "scalp" | "both";
  color: string;
  desc: string;
  checklist: Array<{ id: string; text: string }>;
}

export interface DemoJournal {
  settings: Record<string, unknown>;
  trades: Array<Record<string, unknown>>;
  hyblock: Array<Record<string, unknown>>;
}

const SETUPS: DemoSetup[] = [
  {
    id: "s_demo_bo",
    name: "4H-Breakout (Demo)",
    account: "scalp",
    color: "#6f9dc9",
    desc: "Demo-Setup: 4H-Schluss über dem Widerstand, Stop darunter. Erfundene Regeln für die Vorschau.",
    checklist: [
      { id: "c1", text: "4H-Schluss über dem Widerstand" },
      { id: "c2", text: "Stop unter der Ausbruchskerze" },
      { id: "c3", text: "Volumen über dem Durchschnitt" },
    ],
  },
  {
    id: "s_demo_sw",
    name: "Liquidity Sweep (Demo)",
    account: "both",
    color: "#46a6a0",
    desc: "Demo-Setup: Preis holt Liquidität ab, Struktur dreht zurück.",
    checklist: [
      { id: "c1", text: "Liquidität klar abgeholt" },
      { id: "c2", text: "Reclaim, Struktur dreht" },
    ],
  },
  {
    id: "s_demo_sh",
    name: "Neckline-Short (Demo)",
    account: "scalp",
    color: "#c7768f",
    desc: "Demo-Setup: 4H-Schluss unter der Nackenlinie, Stop darüber.",
    checklist: [
      { id: "c1", text: "4H-Schluss unter der Nackenlinie" },
      { id: "c2", text: "Stop über dem letzten Hoch" },
    ],
  },
  {
    id: "s_demo_mz",
    name: "Makro-Zone (Demo)",
    account: "makro",
    color: "#5fb0d6",
    desc: "Demo-Setup: langsamer Einstieg in einer Unterstützungszone, kleiner Hebel.",
    checklist: [
      { id: "c1", text: "Preis in der Zone" },
      { id: "c2", text: "Erstes Higher Low auf 4H" },
      { id: "c3", text: "Top-down geprüft (W → D → 4H)" },
    ],
  },
];

const EMOTIONS = ["Ruhig", "Fokussiert", "Unsicher", "Ungeduldig", "Ruhig", "Fokussiert"];

/** Small deterministic generator (same sequence on every device). */
function rng(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (Math.imul(s ^ (s >>> 15), 0x2c1b3c6d) + 0x9e3779b9) >>> 0;
    return ((s ^ (s >>> 12)) >>> 0) / 0x1_0000_0000;
  };
}

const p2 = (n: number): string => String(n).padStart(2, "0");
const localStamp = (d: Date): string => `${d.getFullYear()}-${p2(d.getMonth() + 1)}-${p2(d.getDate())}T${p2(d.getHours())}:${p2(d.getMinutes())}`;
const idOf = (n: number): string => `t_demo${n.toString(36).padStart(6, "0")}`;

interface Plan {
  at: Date;
  account: "makro" | "scalp";
  side: "long" | "short";
  outcome: "win" | "loss";
  /** R multiple of the exit (win > 0, loss < 0) */
  r: number;
  followed: boolean;
  setup: string;
  note: string;
}

export function buildDemoJournal(nowMs: number): DemoJournal {
  const now = new Date(nowMs);
  const rand = rng(20261108);
  const plans: Plan[] = [];
  const dayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  const DAY = 86_400_000;

  // today: two scalp losses (most of the daily limit of 4 % of 5.000 = 200 USDT) – the risk page's limit hint
  const t1 = Math.min(Math.max(dayStart + 5 * 60_000, nowMs - 4 * 3_600_000), nowMs - 90_000);
  const t2 = Math.min(Math.max(t1 + 60_000, nowMs - 90 * 60_000), nowMs - 30_000);
  plans.push({ at: new Date(t1), account: "scalp", side: "long", outcome: "loss", r: -1, followed: true, setup: "s_demo_bo", note: "Demo-Eintrag: Ausbruch fehlgeschlagen" });
  plans.push({ at: new Date(t2), account: "scalp", side: "long", outcome: "loss", r: -1.05, followed: false, setup: "s_demo_bo", note: "Demo-Eintrag: gleich noch einmal versucht (nicht nach Plan)" });

  // the weeks before: 0–3 trades a weekday, a plus on average
  for (let back = 1; back <= 40; back++) {
    const day = new Date(dayStart - back * DAY);
    const wd = day.getDay();
    if (wd === 0 || wd === 6) continue;
    const count = rand() < 0.2 ? 0 : 1 + Math.floor(rand() * (back < 9 ? 3 : 2.4));
    for (let k = 0; k < count; k++) {
      const hour = 8 + Math.floor(rand() * 13);
      const at = new Date(day.getFullYear(), day.getMonth(), day.getDate(), hour, Math.floor(rand() * 60));
      const scalp = rand() < 0.72;
      const win = rand() < (scalp ? 0.57 : 0.62);
      const followed = win ? rand() < 0.92 : rand() < 0.55;
      plans.push({
        at,
        account: scalp ? "scalp" : "makro",
        side: rand() < 0.68 ? "long" : "short",
        outcome: win ? "win" : "loss",
        r: win ? Math.round((0.9 + rand() * 1.9) * 100) / 100 : -Math.round((0.85 + rand() * 0.35) * 100) / 100,
        followed,
        setup: scalp ? (["s_demo_bo", "s_demo_sw", "s_demo_sh"] as const)[Math.floor(rand() * 3)]! : rand() < 0.6 ? "s_demo_mz" : "s_demo_sw",
        note: win ? "Demo-Eintrag" : followed ? "Demo-Eintrag: Stop getroffen" : "Demo-Eintrag: Plan nicht eingehalten",
      });
    }
  }
  plans.sort((a, b) => a.at.getTime() - b.at.getTime());

  let price = 80_500;
  const trades = plans.map((p, i) => {
    // a slow drift upwards over the weeks, so entries stay in a believable band
    price += (rand() - 0.42) * 600;
    const entry = Math.round(price / 10) * 10;
    const dir = p.side === "long" ? 1 : -1;
    const stopPct = p.account === "scalp" ? 0.006 + rand() * 0.004 : 0.02 + rand() * 0.012;
    const stop = Math.round(entry * (1 - dir * stopPct));
    const dist = Math.abs(entry - stop);
    const target = Math.round(entry + dir * dist * 2.2);
    const exit = Math.round(entry + dir * dist * p.r);
    const size = p.account === "scalp" ? Math.round((4000 + rand() * 5000) / 100) * 100 : Math.round((8000 + rand() * 6000) / 100) * 100;
    const leverage = p.account === "scalp" ? 4 : 1;
    const fees = Math.round(size * 0.0007 * 100) / 100;
    const qty = size / entry;
    const pnl = Math.round(((exit - entry) * qty * dir - fees) * 100) / 100;
    const risk = dist * qty;
    const r = risk ? Math.round((pnl / risk) * 100) / 100 : null;
    const setup = SETUPS.find((s) => s.id === p.setup)!;
    const checks: Record<string, boolean> = { "g:trigger": true, "g:topdown": p.followed, "g:spx": true, "g:stop": true, "g:lev": true };
    for (const c of setup.checklist) checks[`${setup.id}:${c.id}`] = p.followed || rand() < 0.5;
    const iso = p.at.toISOString();
    return {
      id: idOf(i + 1),
      account: p.account,
      side: p.side,
      status: "closed",
      date: localStamp(p.at),
      pair: "BTC/USDT",
      timeframe: p.account === "scalp" ? "4h" : "1D",
      entry,
      stop,
      target,
      exit,
      size,
      leverage,
      fees,
      pnlManual: null,
      setups: [setup.id],
      checks,
      conviction: p.followed ? 3 + Math.floor(rand() * 3) : 2,
      followedPlan: p.followed,
      emotion: p.followed ? EMOTIONS[Math.floor(rand() * EMOTIONS.length)]! : "Ungeduldig",
      reason: p.followed ? "Setup erfüllt, Stop gesetzt" : "Spontan, Plan verlassen",
      notes: p.note,
      chart: "",
      pnl,
      r,
      createdAt: iso,
      updatedAt: iso,
    };
  });

  const settings: Record<string, unknown> = {
    currency: "USDT",
    pair: "BTC/USDT",
    capital: { makro: "20000", scalp: 5000 },
    setups: SETUPS,
    market: { symbol: "BINANCE:BTCUSDT", longTrigger: 86000 },
  };
  return { settings, trades, hyblock: [] };
}
