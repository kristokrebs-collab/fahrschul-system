/**
 * Helpers shared by the evaluation tools: German number and date words (the same style as the domain texts: decimal comma,
 * real minus sign), the reply builders and the „Öffnen“ buttons. Opening only navigates / scrolls / pre-fills – the sheet
 * closes first so the trader sees the page; nothing is saved or started.
 */
import type { Page } from "@/store/uiStore";
import type { AnswerFact, Tone } from "@/domain/coach/nlq";
import type { ReplyAction, ToolEnv, ToolReply } from "../tools";
import { closeAssistant } from "../open";

export const fact = (label: string, value: string, tone: Tone = "fg", raw: number | null = null): AnswerFact => ({ label, value, raw, tone });
export const reply = (r: Partial<ToolReply> & Pick<ToolReply, "title" | "text">): ToolReply => ({ facts: [], followUps: [], actions: [], tone: "fg", ...r });

export const dec = (v: number, d = 1): string => v.toFixed(d).replace(".", ",").replace("-", "−");
export const rText = (v: number | null | undefined, d = 2): string => (v == null || !Number.isFinite(v) ? "–" : `${v > 0 ? "+" : ""}${dec(v, d)} R`);
export const pctText = (v: number | null | undefined, d = 0): string => (v == null || !Number.isFinite(v) ? "–" : `${dec(v * 100, d)} %`);
export const signedPct = (v: number | null | undefined, d = 1): string => (v == null || !Number.isFinite(v) ? "–" : `${v > 0 ? "+" : ""}${dec(v * 100, d)} %`);
export const range = (lo: number, hi: number): string => `${Math.round(lo * 100)}–${Math.round(hi * 100)} %`;
export const plural = (n: number, one: string, many: string): string => `${n} ${n === 1 ? one : many}`;
export const tone = (v: number | null | undefined): Tone => (v == null || v === 0 ? "fg" : v > 0 ? "win" : "loss");

const p2 = (n: number): string => String(n).padStart(2, "0");
/** `12.10.2026` (local time) */
export const dayText = (ms: number): string => {
  const d = new Date(ms);
  return `${p2(d.getDate())}.${p2(d.getMonth() + 1)}.${d.getFullYear()}`;
};
/** `12.10. 09:30` (local time, no year) */
export const stampText = (ms: number): string => {
  const d = new Date(ms);
  return `${p2(d.getDate())}.${p2(d.getMonth() + 1)}. ${p2(d.getHours())}:${p2(d.getMinutes())}`;
};

export interface Spot {
  /** a function of the register (`src/app/features.ts`): opens its page scrolled to the card, or its sheet */
  feature?: string;
  page: Page;
  /** the `data-testid` of a card on the page – scrolled to when there is no register entry */
  testid?: string;
}

/** Opens `spot` (the sheet closes first). Falls back to the page when the env cannot scroll. */
export function openSpot(env: Pick<ToolEnv, "go" | "openFeature" | "openSpot">, spot: Spot): void {
  closeAssistant();
  if (spot.feature && env.openFeature) env.openFeature(spot.feature);
  else if (spot.testid && env.openSpot) env.openSpot(spot.page, spot.testid);
  else env.go(spot.page);
}

/** A button that opens `spot`. */
export const openAction = (env: Pick<ToolEnv, "go" | "openFeature" | "openSpot">, label: string, spot: Spot): ReplyAction => ({ label, run: () => openSpot(env, spot) });
