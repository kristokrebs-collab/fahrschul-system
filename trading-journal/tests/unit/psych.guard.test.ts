/**
 * Paket P – the guards behind docs/PSYCHOLOGIE.md. They fail when someone later adds what the product decided NOT to build:
 *
 *  1. process feedback (`processDone`) is called only where a process step ends – and only with the closed list of events;
 *  2. every burst of dots (`celebrate*`) comes from a known place; none follows a profit, an import, a market move or a sync;
 *  3. LDW (loss disguised as a win): a loss, an open or flat trade never earns a burst, no fanfare / confetti / near-miss words exist
 *     in the product's strings;
 *  4. no urgency words ("nur noch", "letzte Chance", countdown, scarcity, invented popularity) in the buy and tariff path;
 *  5. every opt-in is OFF by default (feedback channels, review reminder, the pause after losses);
 *  6. Frost (Paket F2): "Heute abschließen" rewards only done process, the journal card dresses no loss up, the question bar stays local.
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { cooldownOf, DEFAULT_RISK, limitsSetByUser, riskLimits } from "@/domain/risk";
import type { EnrichedTrade } from "@/domain/types";
import { winCelebration } from "@/overlays/celebration";

const ROOT = join(__dirname, "..", "..");
const SRC = join(ROOT, "src");

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((n) => {
    const p = join(dir, n);
    return statSync(p).isDirectory() ? walk(p) : [p];
  });
}
const files = walk(SRC).filter((f) => /\.(ts|tsx)$/.test(f) && !/\.test\.(ts|tsx)$/.test(f));
const rel = (f: string) => relative(ROOT, f).replace(/\\/g, "/");

/** Source without comments (block comments, then `//` comments that start a line or follow a space – never the `//` of a URL). */
function code(f: string): string {
  return readFileSync(f, "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/(^|\s)\/\/.*$/gm, "$1");
}
const callers = (re: RegExp): string[] => files.filter((f) => re.test(code(f))).map(rel).sort();

describe("1 · process feedback only after a process step", () => {
  it("is called from exactly the places where a process step ends", () => {
    const where = callers(/\bprocessDone\(/).filter((f) => f !== "src/motion/processFeedback.ts");
    expect(where).toEqual([
      "src/connect/BinanceWizard.tsx",
      "src/exchanges/ui/ConnectSheet.tsx",
      "src/onboarding/wizard/SetupWizard.tsx",
      "src/views/berichte/DayCloseCard.tsx",
      "src/views/berichte/WeekCloseCard.tsx",
      "src/views/settings/DataCard.tsx",
      "src/views/wachstum/PreTradeCheck.tsx",
    ]);
  });

  it("never near a trade, a profit or a loss (editor, journal store, trade list, domain, overview)", () => {
    for (const f of files) {
      if (!/^src\/(overlays|domain|store|views\/trades|views\/overview|views\/cockpit)\//.test(rel(f))) continue;
      expect(code(f), rel(f)).not.toMatch(/\bprocessDone\b/);
    }
  });

  it("every call names an event of the closed list", async () => {
    const { PROCESS_EVENT_IDS } = await import("@/motion/processFeedback");
    for (const f of files) {
      for (const m of code(f).matchAll(/\bprocessDone\(\s*"([^"]+)"/g)) expect(PROCESS_EVENT_IDS, `${rel(f)}: ${m[1]}`).toContain(m[1]);
    }
    expect([...PROCESS_EVENT_IDS].sort()).toEqual(["backup", "checklist", "connection", "dayClose", "weekReview", "wizard"]);
  });
});

describe("2 · bursts of dots: a closed list of places", () => {
  /** Every file that may start a burst, and why. Adding one is a product decision – write it in docs/PSYCHOLOGIE.md first. */
  const ALLOWED: Record<string, string> = {
    "src/overlays/TradeEditor.tsx": "OFFEN (Entscheidung des Betreibers): Gewinn-Burst beim Speichern – bestehender Goldstandard, in diesem Paket bewusst nicht angefasst",
    "src/App.tsx": "Toast-Meilenstein (`milestone`): nur die Prozess-Rückmeldung setzt das Flag",
    "src/views/wachstum/StreakBadge.tsx": "Serien sind Prozess-Serien (Journal, Check-in, Limits gehalten, Disziplin) – nie PnL, nie Handelsvolumen",
    "src/views/wachstum/BestsCard.tsx": "persönliche Bestwerte der Prozess-Serien",
    "src/views/wachstum/transitions.tsx": "erreichte Prozess-/Limit-Ziele (Ergebnis-Ziele feiern nie: `celebrate: false`) und beendete Challenges",
    "src/views/berichte/sections.tsx": "gehaltene Ziele im Bericht (Prozess-Ziele)",
    "src/onboarding/OnboardingTour.tsx": "Ende der Einführung",
    "src/cloud/ui/AuthSheet.tsx": "Konto angelegt",
    "src/cloud/ui/SecurityCard.tsx": "Zwei-Faktor eingerichtet",
    "src/views/preise/ResultView.tsx": "bestätigte Bestellung (kein Kauf-Aufruf im Höhepunkt: sie folgt der Zahlung, geht ihr nie voraus)",
    "src/views/labor/SideCards.tsx": "Referenz aus dem Backtest übernommen (eine Handlung, kein Ergebnis eines Trades)",
  };
  const BURST = /\b(celebrateFrom|celebrateStreak|celebrateRecord|celebrate)\(/;

  it("no place outside the list starts a burst", () => {
    const where = callers(BURST).filter((f) => !/^src\/(motion|store)\//.test(f));
    const unknown = where.filter((f) => !(f in ALLOWED));
    expect(unknown, "neue Stelle mit Konfetti – erst in docs/PSYCHOLOGIE.md entscheiden").toEqual([]);
  });

  it("the places the product removed stay without one (import, sync, market move, connection, risk page, Übersicht)", () => {
    for (const f of [
      "src/exchanges/csv/CsvImportSheet.tsx",
      "src/exchanges/ui/ExchangeConnectionsCard.tsx",
      "src/exchanges/ui/ConnectSheet.tsx",
      "src/connect/BinanceWizard.tsx",
      "src/views/markt/BoxStateCard.tsx",
      "src/views/risiko/LimitsCard.tsx",
      "src/views/risiko/guard.ts",
      "src/views/overview/Hero.tsx",
    ]) {
      expect(code(join(ROOT, f)), f).not.toMatch(BURST);
      expect(code(join(ROOT, f)), f).not.toMatch(/celebrateFrom|celebrateRecord|celebrateStreak/);
    }
  });

  it("the toast flag `milestone` is set only by the process feedback", () => {
    const where = callers(/\bmilestone:\s*true\b/);
    expect(where.filter((f) => f !== "src/app/toasts.ts")).toEqual(["src/motion/processFeedback.ts"]); // the adapter only passes the flag on
  });
});

describe("3 · LDW: a loss never earns a win", () => {
  const trade = (pnl: number | null, status: "open" | "closed" = "closed", r: number | null = null) => ({ id: "t", pnl, status, r, date: "2026-11-02", createdAt: "2026-11-02T10:00:00Z" });
  const noOthers: never[] = [];

  it("only a realised profit can earn a burst – a loss, a flat, an open or an unknown result never", () => {
    for (const pnl of [-250, -0.01, 0, null]) expect(winCelebration(noOthers, trade(pnl)), String(pnl)).toBeNull();
    expect(winCelebration(noOthers, trade(120, "open"))).toBeNull();
    expect(winCelebration(noOthers, trade(Number.NaN))).toBeNull();
  });

  it("an edit that turns a win into a loss (or touches a win again) stays quiet; a partial loss on an old win does not re-celebrate", () => {
    expect(winCelebration(noOthers, trade(-30), { pnl: 80, status: "closed" })).toBeNull();
    expect(winCelebration(noOthers, trade(80), { pnl: 60, status: "closed" })).toBeNull();
  });

  const banned = /Konfetti|Fanfare|Jackpot|Glückwunsch|Volltreffer|Siegesserie|Triumph|Glücksrad|knapp daneben|beinahe gewonnen|fast gewonnen|so nah dran|Beinahe-Treffer/i;
  it("no celebration or near-miss wording anywhere in the product's strings", () => {
    const hits: string[] = [];
    for (const f of files) {
      const lines = code(f).split("\n");
      lines.forEach((l, i) => {
        if (banned.test(l)) hits.push(`${rel(f)}:${i + 1}: ${l.trim().slice(0, 100)}`);
      });
    }
    expect(hits).toEqual([]);
  });

  it("loss figures carry their sign and no festive treatment: the report's net is signed, the same markup for both signs", () => {
    const src = code(join(SRC, "views/berichte/ReportHero.tsx"));
    expect(src).toMatch(/<NumberCascade value=\{Math\.round\(net\)\} signed \/>/);
    expect(src).toMatch(/net > 0 \? "text-win" : net < 0 \? "text-loss" : "text-fg"/);
  });
});

describe("4 · no urgency in the buy and tariff path", () => {
  const PATH = [
    "src/billing/strings.ts",
    "src/billing/purchase/strings.ts",
    "src/billing/purchase/result.ts",
    "src/billing/ctas.ts",
    "src/billing/plans.ts",
    "src/billing/tariff.ts",
    "src/billing/ui/UpgradeSheet.tsx",
    "src/billing/ui/UpgradeTeaser.tsx",
    "src/billing/ui/CancelSheet.tsx",
    "src/billing/ui/PlanCard.tsx",
    "src/billing/ui/BillingBanner.tsx",
    "src/billing/purchase/OrderSheet.tsx",
    "src/billing/purchase/PayStage.tsx",
    "src/billing/purchase/PayButton.tsx",
    "src/billing/purchase/ManageSheet.tsx",
    "src/billing/purchase/TariffDetailSheet.tsx",
    "src/views/preise/strings.ts",
    "src/views/preise/PlanGrid.tsx",
    "src/views/preise/PricingHero.tsx",
    "src/views/preise/PricingFaq.tsx",
    "src/views/preise/ResultView.tsx",
    "src/views/preise/PlanComparison.tsx",
  ];
  const URGENCY = [
    /nur noch/i,
    /letzte chance/i,
    /nur heute/i,
    /nur für kurze zeit/i,
    /angebot (endet|läuft ab)/i,
    /läuft (bald )?ab\b/i,
    /bald vorbei/i,
    /jetzt (schnell|sichern|zugreifen)/i,
    /sichere dir/i,
    /nicht verpassen|verpass (es|dir)/i,
    /ausverkauft|nur wenige (plätze|lizenzen|exemplare|angebote|stück)|begrenzte (anzahl|verfügbarkeit)|limitiert/i,
    /countdown/i,
    /exklusiv|\bvip\b|bestseller/i,
    /\bbeliebt\b|tausende|\d+\s?% (der )?(nutzer|trader|händler)/i,
    /schnäppchen|rabatt endet|(nur|bis) (morgen|mitternacht)/i,
  ];

  it("the files exist (the list is not stale)", () => {
    for (const f of PATH) expect(() => readFileSync(join(ROOT, f), "utf8"), f).not.toThrow();
  });

  it("none of them uses a pressure word", () => {
    const hits: string[] = [];
    for (const f of PATH) {
      code(join(ROOT, f))
        .split("\n")
        .forEach((l, i) => {
          for (const re of URGENCY) if (re.test(l)) hits.push(`${f}:${i + 1}: ${l.trim().slice(0, 100)}`);
        });
    }
    expect(hits).toEqual([]);
  });

  it("the way out is as plain as the way in: „Nein danke“, no shaming", async () => {
    const { UPGRADE } = await import("@/billing/strings");
    expect(UPGRADE.decline).toBe("Nein danke");
    expect(UPGRADE.limitBelongs("Pro")).toBe("Dieses Limit gehört zu Pro.");
    const { PREISE } = await import("@/views/preise/strings");
    expect(PREISE.recommended).toBe("Empfohlen");
  });
});

describe("5 · every opt-in is OFF by default", () => {
  it("feedback channels (vibration, tone)", async () => {
    const { FEEDBACK_DEFAULT, parseFeedback } = await import("@/motion/processFeedback");
    expect(FEEDBACK_DEFAULT).toEqual({ sound: false, haptic: false });
    for (const raw of [null, undefined, {}, { v: 1 }, { v: 2, sound: true, haptic: true }, "x", 3, { sound: true, haptic: true }]) expect(parseFeedback(raw), JSON.stringify(raw)).toEqual({ sound: false, haptic: false });
    expect(parseFeedback({ v: 1, sound: true, haptic: false })).toEqual({ sound: true, haptic: false });
  });

  it("the review reminder", async () => {
    const { REMINDER_DEFAULT, parseReminder } = await import("@/views/berichte/reviewReminder");
    expect(REMINDER_DEFAULT.on).toBe(false);
    for (const raw of [null, undefined, {}, { on: true }, { v: 9, on: true }, "x"]) expect(parseReminder(raw).on, JSON.stringify(raw)).toBe(false);
  });

  it("the pause after losses (and after a breached day) – and the page words limits by who set them", () => {
    expect(DEFAULT_RISK.cooldownMin).toBe(0);
    expect(riskLimits({}).cooldownMin).toBe(0);
    const losses = ["a", "b", "c"].map((id, i) => ({ id, result: "loss", pnl: -5, exitDate: "2026-11-02", exit: 1, entry: 1, status: "closed", date: "2026-11-02", time: `10:0${i}` }) as unknown as EnrichedTrade);
    const now = Date.now();
    expect(cooldownOf({ closed: losses, now, limits: riskLimits({}), dayBreach: true })).toBeNull();
    expect(cooldownOf({ closed: losses, now, limits: riskLimits({ risk: { cooldownMin: 30 } }), dayBreach: true })).not.toBeNull();
    expect(limitsSetByUser({})).toBe(false);
    expect(limitsSetByUser({ discipline: { maxLossDayPct: 0.03 } })).toBe(true);
    expect(limitsSetByUser({ risk: { maxLossWeekPct: 0.05 } })).toBe(true);
    expect(limitsSetByUser({ risk: { cooldownMin: 30 } })).toBe(false);
  });
});

describe("process feedback itself", () => {
  it("ignores anything outside the list and says so", async () => {
    const { processDone } = await import("@/motion/processFeedback");
    const { useUi } = await import("@/store/uiStore");
    const before = useUi.getState().toasts.length;
    expect((processDone as unknown as (e: string) => boolean)("tradeWon")).toBe(false);
    expect((processDone as unknown as (e: string) => boolean)("toString")).toBe(false);
    expect(useUi.getState().toasts.length).toBe(before);
  });

  it("a process step shows ONE quiet toast without a number; vibration and tone only after the person switched them on", async () => {
    const pf = await import("@/motion/processFeedback");
    const { useUi } = await import("@/store/uiStore");
    const vibrate = vi.spyOn(pf.channels, "vibrate").mockImplementation(() => undefined);
    const tone = vi.spyOn(pf.channels, "tone").mockImplementation(() => undefined);
    useUi.setState({ toasts: [] });
    pf.useFeedbackPref.setState({ sound: false, haptic: false });
    for (const e of pf.PROCESS_EVENT_IDS) expect(pf.processDone(e)).toBe(true);
    const toasts = useUi.getState().toasts;
    expect(toasts).toHaveLength(pf.PROCESS_EVENT_IDS.length);
    for (const t of toasts) {
      expect(t.milestone).toBe(true);
      expect(t.value).toBeUndefined();
      expect(t.kind).toBe("success");
      expect(`${t.title} ${t.detail ?? ""}`).not.toMatch(/\d|Gewinn|Profit|Rekord|Serie|Sieg/);
    }
    expect(vibrate).not.toHaveBeenCalled();
    expect(tone).not.toHaveBeenCalled();
    pf.useFeedbackPref.setState({ sound: true, haptic: true });
    pf.processDone("backup");
    expect(vibrate).toHaveBeenCalledTimes(1);
    expect(tone).toHaveBeenCalledTimes(1);
    vibrate.mockRestore();
    tone.mockRestore();
    pf.useFeedbackPref.setState({ sound: false, haptic: false });
  });
});

describe("6 · Frost (Paket F2): Heute abschließen, Journal-Karte, Frag dein Journal", () => {
  it("the day's closing calls the confirmation exactly once, with the one event, and only in the branch of the closing that was `earned`", () => {
    const src = code(join(SRC, "views/berichte/DayCloseCard.tsx"));
    expect([...src.matchAll(/\bprocessDone\(/g)]).toHaveLength(1);
    expect(src).toMatch(/if \(earned\) processDone\("dayClose"\)/);
    // `earned` is the readiness of the PROCESS items at the moment of the tap – nothing else feeds it
    expect(src).toMatch(/const earned = ready;/);
    expect(src).toMatch(/const ready = dayCloseReady\(items\);/);
    // the week's ritual and the day's ritual are the same component (no second system)
    expect(code(join(SRC, "views/berichte/WeekCloseCard.tsx"))).toMatch(/<CloseRitual/);
    expect(src).toMatch(/<CloseRitual/);
  });

  it("what decides a day's closing knows no profit, no loss, no trade count and no order", () => {
    for (const f of ["src/domain/growth/dayClose.ts", "src/views/berichte/DayCloseCard.tsx", "src/views/berichte/CloseRitual.tsx"]) {
      const src = code(join(ROOT, f));
      expect(src, f).not.toMatch(/\b(pnl|net|winRate|profit|gain|avgR|sumR|equity|order|placeOrder)\b/i);
      expect(src, f).not.toMatch(/\.r\b/);
    }
  });

  it("the week of dots never says missed, risk or streak – and a closed day adds no dot by itself", () => {
    const src = code(join(ROOT, "src/domain/growth/dayClose.ts"));
    expect(src.replace(/^import .*$/gm, "")).not.toMatch(/verpass|Serie|streak|Gefahr|Lücke/i);
    expect(src).toMatch(/journalDayOk\(p, key\)/); // the SAME predicate as the streaks
    expect(src).not.toMatch(/dayClosesOf|\.closed\b/); // the closing flag is not read for the dots
  });

  it("the closing is recorded without the confirmation when something is open (the info toast carries no `milestone`)", () => {
    const src = code(join(SRC, "views/berichte/DayCloseCard.tsx"));
    expect(src).toMatch(/else pushToast\(\{ kind: "info"/);
    expect(src).not.toMatch(/milestone/);
  });

  it("the journal card dresses nothing up: one tone function by sign, the same markup for each entry, no celebration in the card", () => {
    const entries = code(join(ROOT, "src/domain/reports/entries.ts"));
    expect(entries).toMatch(/tone: net == null \|\| net === 0 \? "mute" : net > 0 \? "win" : "loss"/);
    const card = code(join(SRC, "views/berichte/JournalCard.tsx"));
    expect(card).not.toMatch(/\b(celebrate\w*|processDone|confetti|Celebrate)\b/i);
    expect(card).toMatch(/TONE_CLASS = \{ win: "text-win", loss: "text-loss", mute: "text-mute" \}/);
  });

  it("the question bar is local: no fetch, no API client, no model SDK in the parser, the answer engine, the word guard or the card", () => {
    const parts = ["src/domain/ask/index.ts", "src/domain/ask/words.ts", "src/domain/coach/nlq/audit.ts", "src/domain/coach/nlq/parse.ts", "src/domain/coach/nlq/answer.ts", "src/views/berichte/AskJournalCard.tsx"];
    for (const f of parts) expect(code(join(ROOT, f)), f).not.toMatch(/\bfetch\(|apiFetch|@anthropic-ai|XMLHttpRequest|WebSocket|navigator\.sendBeacon|rephraseAnswer|Math\.random/);
  });

  it("no pressure or festive word in the three new cards' strings", () => {
    const bad = /nur noch|letzte chance|verpass|countdown|in gefahr|jetzt sofort|Glückwunsch|Rekord|Serie|knapp|fast gewonnen/i;
    for (const f of ["views/berichte/JournalCard.tsx", "views/berichte/DayCloseCard.tsx", "views/berichte/CloseRitual.tsx", "views/berichte/AskJournalCard.tsx", "domain/ask/index.ts", "domain/growth/dayClose.ts"]) {
      expect(code(join(SRC, f)), f).not.toMatch(bad);
    }
  });
});
