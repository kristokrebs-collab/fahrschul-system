/**
 * "Checklisten-Auswertung" – logic of the bundle's `khe` card (48405–48565) as pure data.
 */
import type { EnrichedTrade } from "./types";
import { aggregate, type Agg } from "./agg";
import { pct0, signed } from "@/lib/format";
import type { Explanation, Verdict } from "./explain";

export interface MissedItem {
  text: string;
  /** how often the item was left unchecked */
  n: number;
  /** of those, how many trades were losses */
  loss: number;
}

export interface ChecklistEvaluation {
  /** closed trades that have at least one checklist item */
  withList: EnrichedTrade[];
  /** "Alles erfüllt" */
  full: Agg;
  /** "Mit Lücken" */
  gaps: Agg;
  /** "Am häufigsten ausgelassen", top 3 by count */
  missed: MissedItem[];
  /** per item: win rate with vs without the item checked */
  items: ChecklistItemStats[];
}

export interface ChecklistItemStats {
  text: string;
  /** trades in which the item was part of the checklist */
  n: number;
  withChecked: Agg;
  withoutChecked: Agg;
  /** winRate(with) − winRate(without), null when one side is empty */
  delta: number | null;
}

export const CHECKLIST_CARD_TITLE = "Checkliste";
export const CHECKLIST_MISSED_TITLE = "Am häufigsten ausgelassen";
export const CHECKLIST_MISSED_EMPTY = "Bisher alles abgehakt.";
export const CHECKLIST_EMPTY_TITLE = "Noch keine Auswertung";
export const CHECKLIST_EMPTY_TEXT =
  "Hake beim Eintragen ab, welche Regeln erfüllt waren. Hier siehst du dann, ob sich Disziplin auszahlt.";
export const CHECKLIST_TILE_FULL = "Alles erfüllt";
export const CHECKLIST_TILE_GAPS = "Lücken";

export function evaluateChecklist(closed: readonly EnrichedTrade[]): ChecklistEvaluation {
  const withList = closed.filter((t) => t.items.length);
  const full = aggregate(withList.filter((t) => t.complete));
  const gaps = aggregate(withList.filter((t) => !t.complete));

  const missedMap = new Map<string, MissedItem>();
  const perItem = new Map<string, { text: string; on: EnrichedTrade[]; off: EnrichedTrade[] }>();
  for (const t of withList) {
    for (const it of t.items) {
      const checked = !!t.checks?.[it.id];
      const p = perItem.get(it.text) ?? { text: it.text, on: [], off: [] };
      (checked ? p.on : p.off).push(t);
      perItem.set(it.text, p);
      if (!checked) {
        const c = missedMap.get(it.text) ?? { text: it.text, n: 0, loss: 0 };
        c.n++;
        if (t.result === "loss") c.loss++;
        missedMap.set(it.text, c);
      }
    }
  }
  const missed = [...missedMap.values()].sort((a, b) => b.n - a.n).slice(0, 3);
  const items: ChecklistItemStats[] = [...perItem.values()].map((p) => {
    const withChecked = aggregate(p.on);
    const withoutChecked = aggregate(p.off);
    return {
      text: p.text,
      n: p.on.length + p.off.length,
      withChecked,
      withoutChecked,
      delta: withChecked.n && withoutChecked.n ? (withChecked.winRate ?? 0) - (withoutChecked.winRate ?? 0) : null,
    };
  });
  return { withList, full, gaps, missed, items };
}

/** Card row: "{n}× · {round(loss/n·100)} % Verlust". */
export function missedLabel(m: MissedItem): string {
  return `${m.n}× · ${Math.round((m.loss / m.n) * 100)} % Verlust`;
}

/** Tile caption: "{n} Trades · {signed(net,0)}". */
export function checklistTileCaption(g: Agg): string {
  return `${g.n} Trades · ${signed(g.net, 0)}`;
}

/** Explainer of the card ("Details"). */
export function explainChecklist(ev: ChecklistEvaluation): Explanation {
  const { withList, full, gaps } = ev;
  const verdict: Verdict =
    !full.n || !gaps.n
      ? { tone: "mute", text: "Für einen Vergleich brauchst du Trades mit und ohne vollständige Checkliste." }
      : (full.winRate || 0) >= (gaps.winRate || 0)
        ? { tone: "win", text: "Mit voller Checkliste gewinnst du öfter. Die Regeln wirken." }
        : { tone: "warn", text: "Mit Lücken läuft es bisher besser. Prüfe, ob die Checklisten-Punkte zu deinem Stil passen." };
  return {
    key: "checklist",
    title: "Checklisten-Auswertung",
    what: "Vergleicht Trades, bei denen du alle Punkte (Grundregeln plus Punkte der gewählten Grundlagen) abgehakt hast, mit Trades, bei denen etwas gefehlt hat. So siehst du schwarz auf weiß, ob sich Disziplin auszahlt.",
    rows: [
      ["Trades mit Checkliste", String(withList.length)],
      ["Alles erfüllt", `${full.n} · ${pct0(full.winRate)} Win-Rate`],
      ["Mit Lücken", `${gaps.n} · ${pct0(gaps.winRate)} Win-Rate`],
      [
        "Differenz",
        full.n && gaps.n ? `${signed(((full.winRate || 0) - (gaps.winRate || 0)) * 100, 0)} Prozentpunkte` : "–",
      ],
    ],
    verdict,
  };
}
