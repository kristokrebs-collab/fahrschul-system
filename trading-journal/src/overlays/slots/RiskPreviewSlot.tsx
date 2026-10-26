/**
 * Risk preview of the trade being edited (P05 `useRiskPreview`, P14 slot in the TradeEditor's "Preise & Größe"): the
 * risk in % of the account, the approximate liquidation and every limit the trade would touch (per-trade risk,
 * leverage rule, liquidation before the stop, day limit, open risk, trades per day, a running pause). Warnings only –
 * the trade can always be saved. A new breach shakes the size field once (`shakeField`). Lazy chunk of the editor, so
 * the risk domain stays out of the first load. Rows enter on `tween.fade`; reduced motion: static.
 */
import { AnimatePresence, motion } from "motion/react";
import { useEffect, useRef } from "react";
import type { AccountId, Side, TradeStatus } from "@/domain/types";
import { cn } from "@/lib/cn";
import { n1, price as fmtPrice } from "@/lib/format";
import { tween } from "@/motion/tokens";
import { useReducedFx } from "@/motion/useReducedFx";
import { shakeField } from "@/primitives/fieldFx";
import { useRiskPreview } from "@/views/risiko/hooks";

export interface RiskPreviewSlotProps {
  id?: string;
  account: AccountId;
  side: Side;
  status: TradeStatus;
  entry: number | null;
  stop: number | null;
  target: number | null;
  size: number | null;
  qty?: number | null;
  leverage: number | null;
  marginMode?: "isolated" | "cross";
  margin?: number | null;
  /** id of the size input (shaken on a new breach) */
  sizeFieldId?: string;
}

export const RISK_PREVIEW_STRINGS = {
  title: "Risiko-Check",
  ok: "Innerhalb deiner Limits.",
  riskPct: "Risiko vom Konto",
  liq: "Liquidation ≈",
  hint: "Nur ein Hinweis – speichern geht immer.",
} as const;

export default function RiskPreviewSlot({ sizeFieldId = "f-size", ...draft }: RiskPreviewSlotProps) {
  const reduced = useReducedFx();
  const preview = useRiskPreview(draft);
  const state = preview?.state ?? "ok";
  const prev = useRef(state);
  useEffect(() => {
    const was = prev.current;
    prev.current = state;
    if (state === "breach" && was !== "breach") shakeField(sizeFieldId, { reduced });
  }, [state, sizeFieldId, reduced]);
  if (!preview || (preview.riskPct == null && preview.liqPrice == null && preview.warnings.length === 0)) return null;
  const tone = state === "breach" ? "border-loss/40 bg-loss/[0.06]" : state === "warn" ? "border-warn/35 bg-warn/[0.05]" : "border-line bg-ink-950/50";
  return (
    <section aria-label={RISK_PREVIEW_STRINGS.title} data-testid="risk-preview" data-state={state} className={cn("grid gap-2 rounded-xl border px-3 py-2.5 transition-colors duration-300", tone)}>
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
        <span className="text-[10px] font-semibold uppercase tracking-[0.1em] text-faint">{RISK_PREVIEW_STRINGS.title}</span>
        <span className="num flex flex-wrap gap-x-4 font-mono text-[12px] text-mute">
          {preview.riskPct != null && (
            <span>
              {RISK_PREVIEW_STRINGS.riskPct}{" "}
              <span className={cn("font-medium", state === "breach" ? "text-loss" : state === "warn" ? "text-warn" : "text-fg")}>{n1(preview.riskPct * 100)} %</span>
            </span>
          )}
          {preview.liqPrice != null && (
            <span>
              {RISK_PREVIEW_STRINGS.liq} <span className="font-medium text-fg">{fmtPrice(preview.liqPrice)}</span>
            </span>
          )}
        </span>
      </div>
      {preview.warnings.length === 0 ? (
        <p className="text-[12px] text-mute">{RISK_PREVIEW_STRINGS.ok}</p>
      ) : (
        <ul className="grid gap-1.5">
          <AnimatePresence initial={false}>
            {preview.warnings.map((w) => (
              <motion.li
                key={w.key}
                className="flex items-start gap-2 text-[12.5px] leading-snug"
                initial={reduced ? false : { opacity: 0, y: 4 }}
                animate={{ opacity: 1, y: 0, transitionEnd: { transform: "none" } }}
                exit={{ opacity: 0, transition: reduced ? { duration: 0 } : tween.exit }}
                transition={tween.fade}
              >
                <span aria-hidden="true" className={cn("mt-[5px] size-1.5 shrink-0 rounded-full", w.tone === "breach" ? "bg-loss" : "bg-warn")} />
                <span>
                  <span className={cn("font-medium", w.tone === "breach" ? "text-loss" : "text-warn")}>{w.title}</span>
                  <span className="text-mute"> · {w.detail}</span>
                </span>
              </motion.li>
            ))}
          </AnimatePresence>
        </ul>
      )}
      {state !== "ok" && <p className="text-[11px] text-faint">{RISK_PREVIEW_STRINGS.hint}</p>}
    </section>
  );
}
