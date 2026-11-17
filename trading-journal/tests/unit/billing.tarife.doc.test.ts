/**
 * `docs/TARIFE.md` – the tariff contract in words – is generated from the ONE source (`src/billing/plans.ts` + `tariff.ts`):
 * the tables between the markers must be exactly what the code says today. A changed plan, quota or F-ID row therefore shows
 * up here as a failing line; `TARIFE_WRITE=1 npx vitest run tests/unit/billing.tarife.doc.test.ts` rewrites the tables.
 * The prose around them is written by hand and stays.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { COMPARISON_GOALS, FEATURE_INFO, featuresOfGoal, GOAL_NAME, LIMIT_INFO, LIMIT_ORDER, LIST_PRICES, PLAN_CATALOG, PLAN_LIMITS, planIncludes } from "@/billing/plans";
import { accessOf, fullPlanOf, startPlanOf, tariffByGoal } from "@/billing/tariff";
import { LIMIT_KEYS, PLAN_IDS, type LimitKey, type PlanId } from "@/billing/types";

const FILE = join(dirname(fileURLToPath(import.meta.url)), "../../docs/TARIFE.md");
const START = "<!-- tarife:start (erzeugt aus src/billing/plans.ts und tariff.ts – nicht von Hand ändern) -->";
const END = "<!-- tarife:end -->";

const NAME = (p: PlanId): string => PLAN_CATALOG[p].name;
const cell = (s: string): string => s.replace(/\|/g, "/");

/** Where a quota's value comes from – the operator needs to know which numbers are theirs to release. */
const ORIGIN: Readonly<Record<LimitKey, string>> = {
  exchangeConnections: "Free = Vorgabe des Betreibers (1, lesend, von Hand); Pro / Premium / Team = Vorschlag (5 ab Premium)",
  backgroundSyncConnections: "Vorschlag (folgt aus: Auto-Sync ab Pro, so viele wie Verbindungen)",
  tvConnections: "Free = Vorgabe des Betreibers (1); Pro / Premium / Team = Vorschlag, nicht abgesprochen",
  alertChannels: "Vorschlag (Browser; plus E-Mail ab Pro; plus Telefon ab Premium)",
  phoneCallsPerMonth: "Vorschlag (0 / 0 / 30 / 60)",
  screenshotStorageMb: "bestehend (unverändert)",
  shotExtractPerDay: "Vorschlag (0 / 0 / 20 / 20; bisher 30 in Premium)",
  coachAiPerDay: "bestehend (0 / 0 / 50 / 50)",
  simulationsPerDay: "Vorschlag (20 / 200 / ∞ / ∞)",
  savedViews: "bestehend (unverändert)",
  dashboards: "bestehend (unverändert)",
  groups: "bestehend (unverändert)",
};

const num = (v: number, key: LimitKey): string => {
  if (!Number.isFinite(v)) return "∞";
  if (v === 0) return "–";
  return key === "screenshotStorageMb" ? `${v / 1024} GB` : String(v);
};

const money = (cents: number): string => `${(cents / 100).toLocaleString("de-DE", { minimumFractionDigits: cents % 100 ? 2 : 0 })} €`;

function generated(): string {
  const out: string[] = [];
  out.push("### Preise (unverändert)", "", "| Tarif | Monat | Jahr |", "|---|---|---|", "| Free | 0 € | 0 € |");
  out.push(`| Pro | ${money(LIST_PRICES.pro.month)} | ${money(LIST_PRICES.pro.year)} |`);
  out.push(`| Premium | ${money(LIST_PRICES.premium.month)} | ${money(LIST_PRICES.premium.year)} |`);
  out.push(`| Team (je Sitz, mindestens ${PLAN_CATALOG.team.minSeats} Sitze) | ${money(LIST_PRICES.team.month)} | ${money(LIST_PRICES.team.year)} |`, "");

  out.push("### Funktionen je Tarif (nach Nutzerziel)", "", `| Nutzerziel | Funktion | ${PLAN_IDS.map(NAME).join(" | ")} |`, `|---|---|${PLAN_IDS.map(() => "---").join("|")}|`);
  for (const g of COMPARISON_GOALS) {
    for (const f of featuresOfGoal(g.goal)) out.push(`| ${g.label} | ${cell(FEATURE_INFO[f].label)} | ${PLAN_IDS.map((p) => (planIncludes(p, f) ? "ja" : "–")).join(" | ")} |`);
  }
  out.push("");

  out.push("### Kontingente (Team je Sitz)", "", `| Kontingent | ${PLAN_IDS.map(NAME).join(" | ")} | Zustand | Durchgesetzt durch | Herkunft der Zahl |`, `|---|${PLAN_IDS.map(() => "---").join("|")}|---|---|---|`);
  for (const k of LIMIT_ORDER) {
    const info = LIMIT_INFO[k];
    out.push(`| ${info.label} | ${PLAN_IDS.map((p) => num(PLAN_LIMITS[p][k], k)).join(" | ")} | ${info.state === "live" ? "gebaut" : "geplant – nicht auf der Preisseite"} | ${cell(info.enforcedBy)} | ${cell(ORIGIN[k])} |`);
  }
  out.push("");

  out.push("### Die 74 Funktionen", "", "„Ab“ = der Tarif, ab dem die Funktion in ihrem Kern nutzbar ist; „vollständig ab“ = ab dem auch ihre Teile aus höheren Tarifen dabei sind. Die Kontingente begrenzen die Menge, nicht den Zugang.", "");
  for (const { goal, rows } of tariffByGoal()) {
    out.push(`**${GOAL_NAME[goal]}**`, "", `| F-ID | Funktion | Ab | Vollständig ab | Free | Pro | Premium | Team | Kontingente |`, "|---|---|---|---|---|---|---|---|---|");
    for (const t of rows) {
      const acc = (p: PlanId): string => ({ voll: "voll", teilweise: "Kern", nein: "–" })[accessOf(t, p)];
      out.push(`| ${t.fid} | ${cell(t.name)} | ${NAME(startPlanOf(t))} | ${NAME(fullPlanOf(t))} | ${PLAN_IDS.map(acc).join(" | ")} | ${t.limits.map((k) => LIMIT_INFO[k].label).join(", ") || "–"} |`);
    }
    out.push("");
  }
  return out.join("\n");
}

describe("docs/TARIFE.md", () => {
  it("holds the tables exactly as the code says them today", () => {
    const text = readFileSync(FILE, "utf8");
    const a = text.indexOf(START);
    const b = text.indexOf(END);
    expect(a, "start marker").toBeGreaterThan(-1);
    expect(b, "end marker").toBeGreaterThan(a);
    const table = `${generated()}\n`;
    if (process.env.TARIFE_WRITE) {
      writeFileSync(FILE, `${text.slice(0, a + START.length)}\n\n${table}${text.slice(b)}`);
      return;
    }
    expect(text.slice(a + START.length, b).trim()).toBe(table.trim());
  });

  it("says plainly that the numbers are a proposal the operator releases", () => {
    const text = readFileSync(FILE, "utf8");
    expect(text).toMatch(/Vorschlag, vom Betreiber freizugeben/);
    expect(LIMIT_KEYS.every((k) => text.includes(LIMIT_INFO[k].label))).toBe(true);
  });
});
