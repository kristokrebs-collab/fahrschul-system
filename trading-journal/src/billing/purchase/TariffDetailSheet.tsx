/**
 * Tariff detail (B4) – a glass sheet: the benefit of the plan, what it includes, its LIMITS and what it unlocks after the
 * purchase. Everything is read from the tariff contract (`plans.ts`, `tariff.ts`, `docs/TARIFE.md`): no number and no
 * function appears here that the contract does not name, and a quota whose function is not built yet (`LIMIT_INFO.state`
 * "geplant") is not shown at all (it would read as a promise). The way on is the order sheet (`requestOrder`).
 */
import { useMemo } from "react";
import { Sheet, StaggerItem } from "@/motion/Sheet";
import { Button } from "@/primitives/Button";
import { PRICE_TAX_NOTE } from "./strings";
import { displayPrice, formatMoney } from "../format";
import { FEATURE_INFO, featureOffered, GOAL_NAME, LIMIT_INFO, LIMIT_ORDER, PLAN_CATALOG, PLAN_LIMITS, PLAN_FEATURES, limitOffered, type PaidPlanId } from "../plans";
import { closeDetail, requestOrder, useBilling, useOffer } from "../store";
import { accessOf, FUNCTION_TARIFF, fullPlanOf } from "../tariff";
import { FEATURES } from "../types";
import { Mark } from "../ui/parts";
import { savingLabel, planSaving } from "./order";
import { DETAIL } from "./strings";
import "./purchase.css";

const SHOW = 14;

export function TariffDetailSheet({ onNavigate }: { onNavigate?: (page: "preise" | "konto") => void }) {
  const detail = useBilling((s) => s.detail);
  const interval = useBilling((s) => s.interval);
  const config = useBilling((s) => s.config);
  const seats = useBilling((s) => s.seats);
  const offer = useOffer();
  const plan: PaidPlanId = detail.plan ?? "pro";
  const cat = PLAN_CATALOG[plan];

  const view = useMemo(() => {
    const included = FEATURES.filter((f) => PLAN_FEATURES[plan].has(f) && !PLAN_FEATURES.free.has(f) && featureOffered(f, offer));
    const limits = LIMIT_ORDER.filter((k) => limitOffered(k, offer)).map((k) => ({ key: k, info: LIMIT_INFO[k], value: PLAN_LIMITS[plan][k] }));
    const gained = FUNCTION_TARIFF.filter((t) => accessOf(t, plan) !== "nein" && accessOf(t, "free") !== "voll" && (accessOf(t, plan) === "voll" || accessOf(t, "free") === "nein"));
    const partial = FUNCTION_TARIFF.filter((t) => accessOf(t, plan) === "teilweise");
    return { included, limits, gained, partial };
  }, [plan, offer]);

  const price = displayPrice(plan, interval, config?.prices);
  const saving = savingLabel(planSaving(plan, config?.prices));
  const per = interval === "month" ? "pro Monat" : "pro Jahr";

  return (
    <Sheet
      open={detail.open}
      onClose={closeDetail}
      title={DETAIL.title}
      size="md"
      dismissGuard={false}
      className="pay-sheet"
      footer={
        <>
          {onNavigate && (
            <Button
              size="sm"
              variant="ghost"
              onClick={() => {
                closeDetail();
                onNavigate("preise");
              }}
            >
              {DETAIL.compare}
            </Button>
          )}
          <span className="flex-1" />
          <Button
            variant="primary"
            fx={false}
            onClick={() => {
              closeDetail();
              requestOrder({ plan, interval, ...(plan === "team" ? { seats } : {}) });
            }}
            data-testid="detail-order"
          >
            {DETAIL.order}
          </Button>
        </>
      }
    >
      <div className="grid gap-5" data-testid="detail-sheet" data-plan={plan}>
        <StaggerItem className="pay-glass grid gap-2 p-4 sm:p-5">
          <span className="label">{DETAIL.benefit}</span>
          <h3 className="text-[clamp(22px,6vw,28px)] font-semibold leading-tight tracking-tight">Trade Journal {cat.name}</h3>
          <p className="text-[13.5px] leading-relaxed text-mute">{cat.tagline}</p>
          <p className="num font-mono text-[13px]" data-testid="detail-price">
            {formatMoney(price.amount, price.currency)} {cat.perSeat ? "pro Sitz " : ""}
            {per}
            {saving && interval === "year" ? ` · Jährlich ${saving} gegenüber 12 Monatszahlungen` : ""}
          </p>
          <p className="text-[12px] text-faint">{PRICE_TAX_NOTE}</p>
        </StaggerItem>

        <StaggerItem className="grid gap-2">
          <span className="text-[12px] font-semibold text-mute">{DETAIL.included}</span>
          <ul className="grid gap-2 sm:grid-cols-2" data-testid="detail-included">
            {view.included.map((f, i) => (
              <li key={f} className="flex items-start gap-2.5 text-[13.5px]" title={FEATURE_INFO[f].pitch}>
                <Mark on delay={0.15 + i * 0.03} className="mt-px shrink-0" />
                <span>{FEATURE_INFO[f].label}</span>
              </li>
            ))}
          </ul>
        </StaggerItem>

        <StaggerItem className="grid gap-2">
          <span className="text-[12px] font-semibold text-mute">{DETAIL.limits}</span>
          <p className="text-[12px] text-faint">{DETAIL.limitsLead}</p>
          <dl className="grid gap-1" data-testid="detail-limits">
            {view.limits.map(({ key, info, value }) => (
              <div key={key} className="flex items-baseline justify-between gap-4 border-b border-line py-1.5 text-[13.5px] last:border-b-0">
                <dt className="text-mute">{info.label}</dt>
                <dd className="num font-mono">{Number.isFinite(value) ? `${value.toLocaleString("de-DE")}${info.unit ? ` ${info.unit}` : ""}` : DETAIL.unlimited}</dd>
              </div>
            ))}
          </dl>
        </StaggerItem>

        <StaggerItem className="grid gap-2">
          <span className="text-[12px] font-semibold text-mute">{DETAIL.unlocks}</span>
          {view.gained.length === 0 ? (
            <p className="text-[13.5px] text-mute">{DETAIL.none}</p>
          ) : (
            <>
              <p className="text-[12px] text-faint">{DETAIL.unlocksLead(view.gained.length)}</p>
              <ul className="grid gap-1.5 text-[13.5px]" data-testid="detail-unlocks">
                {view.gained.slice(0, SHOW).map((t) => (
                  <li key={t.fid} className="flex items-baseline justify-between gap-3">
                    <span>{t.name}</span>
                    <span className="shrink-0 text-[11.5px] text-faint">{GOAL_NAME[t.goal]}</span>
                  </li>
                ))}
                {view.gained.length > SHOW && <li className="text-mute">{DETAIL.more(view.gained.length - SHOW)}</li>}
              </ul>
            </>
          )}
        </StaggerItem>

        {view.partial.length > 0 && (
          <StaggerItem className="grid gap-2">
            <span className="text-[12px] font-semibold text-mute">{DETAIL.partial}</span>
            <p className="text-[12px] text-faint">{DETAIL.partialLead}</p>
            <ul className="grid gap-1.5 text-[13.5px]" data-testid="detail-partial">
              {view.partial.slice(0, 8).map((t) => (
                <li key={t.fid} className="flex items-baseline justify-between gap-3">
                  <span>{t.name}</span>
                  <span className="shrink-0 text-[11.5px] text-faint">ganz ab {PLAN_CATALOG[fullPlanOf(t)].name}</span>
                </li>
              ))}
              {view.partial.length > 8 && <li className="text-mute">{DETAIL.more(view.partial.length - 8)}</li>}
            </ul>
          </StaggerItem>
        )}

        <StaggerItem>
          <p className="text-[12px] text-faint">{DETAIL.honest}</p>
        </StaggerItem>
      </div>
    </Sheet>
  );
}
