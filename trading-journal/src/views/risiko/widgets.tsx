/**
 * Cockpit widgets of the Risiko page (P05 → P13): components without props that read the same hooks as the page.
 * Shape like `ANALYSE_WIDGETS`: `{ id, title, component, defaultSpan }`.
 */
import type { ComponentType } from "react";
import { riskWarnings } from "@/domain/risk";
import { CalculatorCard } from "./CalculatorCard";
import { ExposureCard } from "./ExposureCard";
import { useExposure, useLimitReport, useRiskBase } from "./hooks";
import { LimitsCard } from "./LimitsCard";
import { RISIKO } from "./strings";

function LimitsWidget() {
  const base = useRiskBase();
  const report = useLimitReport(base);
  return <LimitsCard report={report} now={base.now} warnings={riskWarnings({ report, now: base.now })} />;
}

function ExposureWidget() {
  const base = useRiskBase();
  const ex = useExposure(base);
  return <ExposureCard ex={ex} cur={base.cur} />;
}

function CalculatorWidget() {
  const base = useRiskBase();
  return <CalculatorCard base={base} />;
}

export interface RiskWidget {
  id: string;
  title: string;
  component: ComponentType;
  /** columns of 12 on large screens */
  defaultSpan: number;
}

export const RISIKO_WIDGETS: readonly RiskWidget[] = [
  { id: "risk-limits", title: RISIKO.limits.title, component: LimitsWidget, defaultSpan: 7 },
  { id: "risk-exposure", title: RISIKO.exposure.title, component: ExposureWidget, defaultSpan: 5 },
  { id: "risk-calc", title: RISIKO.calc.title, component: CalculatorWidget, defaultSpan: 7 },
];
