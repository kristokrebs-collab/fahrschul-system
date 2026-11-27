/**
 * „Rechnung“ unter dem Ergebnis des Rechners (eigener Lazy-Chunk samt Stylesheet, Frost): die Positionsgröße als große Zahl, die
 * Posten der Rechnung (Positionswert, nötiger Hebel gegen die eigene Regel, Abstand zum Stop in % und ATR, Verlust am Stop, was davon
 * Gebühren und Slippage sind, der Mindestabstand, der Betrag am Ziel nach Gebühren), eine Preisleiter (Ziel / Einstieg / Stop) und die
 * Hinweise in Worten. Dazu sichtbar: die Annahmen (Gebühr je Seite, Slippage am Stop) und die Rundung auf einen Mengenschritt – nur
 * als Hinweis mit einem Beispiel-Schritt, denn den echten Schritt nennt die Börse.
 *
 * Eine Rechnung aus den Eingaben, keine Empfehlung: es gibt keinen Orderknopf, belohnt wird nichts; „im Rahmen deiner Regeln“ ist die
 * einzige ruhige Bestätigung. Die Rechnung selbst ist rein (`positionBill`, `@/domain/risk`).
 *
 * Bewegung: die Posten bauen sich einmal nacheinander auf (45 ms, CSS), die Zahl der Größe läuft mit `MotionNumber` auf den neuen Wert,
 * Leiter und Hebel-Balken federn per transform. Reduzierte Bewegung: Endzustand sofort. Feste Mindesthöhe (1096 / 722 px; der Platzhalter in
 * `CalculatorCard` hat dieselbe), damit beim Nachladen nichts springt.
 */
import { useMemo } from "react";
import { COST_SHARE_WARN, positionBill, type BillNote, type RiskLimits, type Sizing } from "@/domain/risk";
import { MotionNumber } from "@/motion/MotionNumber";
import type { CalcModel } from "./CalculatorCard";
import { RISIKO } from "./strings";
import { money, pct, priceText, qtyText } from "./ui";
import "./bill.css";

const S = RISIKO.bill;
const H = 248;
const PAD = 26;
const x1 = (v: number, d = 1): string => v.toFixed(d).replace(".", ",");

/** "BTC/USDT" / "LTCUSDT" → "BTC" / "LTC" (what the quantity counts). */
export const unitOf = (pair: string): string => {
  const p = pair.trim().toUpperCase();
  if (p.includes("/")) return p.split("/")[0] ?? "";
  return p.replace(/(USDT|USDC|USD|EUR)$/, "") || p;
};

interface Props {
  m: CalcModel;
  sizing: Sizing;
  limits: RiskLimits;
  cur: string;
  atr: number | null;
}

export default function CalcBill({ m, sizing, limits, cur, atr }: Props) {
  const rule = limits.leverageRule[m.account];
  const bill = useMemo(
    () => positionBill({ sizing, capital: m.capital, entry: m.entry, stop: m.stop, target: m.target, feePct: limits.feePct, slippagePct: limits.slippagePct, atr, ownRiskPct: limits.riskPerTradePct }),
    [sizing, m.capital, m.entry, m.stop, m.target, limits.feePct, limits.slippagePct, limits.riskPerTradePct, atr],
  );
  const unit = unitOf(m.pair);
  const long = sizing.side === "long";
  const tgt = bill.target?.price ?? null;

  // ladder: the three prices on one scale (without a target the 1 R point keeps the entry off the edge)
  const far = tgt ?? m.entry + (m.entry - m.stop);
  const hi = Math.max(m.entry, m.stop, far);
  const lo = Math.min(m.entry, m.stop, far);
  const Y = (p: number): number => PAD + ((hi - p) / (hi - lo || 1)) * (H - 2 * PAD);
  const yE = Y(m.entry);
  const yS = Y(m.stop);
  const yT = tgt != null ? Y(tgt) : yE;
  const line = (y: number): React.CSSProperties => ({ transform: `translate3d(0, ${y.toFixed(1)}px, 0)` });
  const zone = (a: number, b: number): React.CSSProperties => ({ transform: `translate3d(0, ${Math.min(a, b).toFixed(1)}px, 0) scaleY(${Math.abs(a - b).toFixed(1)})` });

  const levShare = Math.min(1, sizing.neededLeverage / (rule * 1.25));
  const levTone = sizing.overRule ? "bad" : sizing.neededLeverage > rule * 0.6 ? "warn" : "ok";

  const noteText = (n: BillNote): string => {
    switch (n.code) {
      case "overRule":
        return S.notes.overRule(rule, x1(sizing.neededLeverage));
      case "marginOver":
        return RISIKO.calc.marginOver;
      case "overRisk":
        return S.notes.overRisk(pct(limits.riskPerTradePct, 2), pct(bill.riskPct, 2), money(sizing.riskAmount, cur));
      case "cost":
        return S.notes.cost(pct(bill.costShare, 0), pct(bill.minDistPct, 2));
      case "tight":
        return S.notes.tight(x1(bill.stopAtr ?? 0, 2));
      case "targetSide":
        return RISIKO.calc.errors.target;
      default:
        return S.notes.ok(pct(sizing.stopPct, 2), x1(sizing.neededLeverage), pct(bill.riskPct, 2));
    }
  };

  const rows: { key: string; label: string; value: string; sub?: string; tone?: "loss" | "win" | "warn" }[] = [
    { key: "notional", label: S.notional, value: money(sizing.notional, cur) },
    { key: "dist", label: S.dist, value: `${priceText(sizing.stopDist)} · ${pct(sizing.stopPct, 2)}`, sub: bill.stopAtr != null ? `${x1(bill.stopAtr, 2)} ATR` : S.noAtr },
    { key: "loss", label: S.loss, value: money(-sizing.riskAmount, cur), sub: pct(bill.riskPct, 2), tone: "loss" },
    { key: "cost", label: S.cost, value: `${money(bill.cost, cur)} · ${pct(bill.costShare, 0)}`, sub: S.costSub(money(sizing.fees, cur), money(sizing.slippage, cur)), tone: bill.costShare > COST_SHARE_WARN ? "warn" : undefined },
    { key: "min", label: S.minDist, value: `${priceText(bill.minDist)} · ${pct(bill.minDistPct, 2)}`, sub: bill.belowMin ? S.minBelow : S.minOk, tone: bill.belowMin ? "warn" : undefined },
    bill.target
      ? { key: "gain", label: S.gain, value: money(bill.target.gain, cur, true), sub: `${S.rr} 1:${x1(bill.target.rr.rr)} · ${S.rrNet} 1:${x1(bill.target.rr.rrNet, 2)}`, tone: "win" }
      : { key: "gain", label: S.gain, value: "–", sub: bill.targetWrongSide ? S.targetWrong : S.noTarget },
  ];

  return (
    <section className="bl-frost" aria-label={S.title} data-testid="risk-bill" data-tone={bill.tone} data-side={sizing.side}>
      <header className="bl-head">
        <span className="bl-kicker">{S.kicker}</span>
        <h3>{S.title}</h3>
      </header>
      <div className="bl-body">
        <div className="bl-main">
          <div className="bl-size" style={{ "--k": 0 } as React.CSSProperties}>
            <span className="bl-label">{S.size}</span>
            <output data-testid="risk-bill-qty">
              <MotionNumber value={sizing.qty} format={qtyText} />
              <small>{unit}</small>
            </output>
          </div>
          <div className="bl-lev" style={{ "--k": 1 } as React.CSSProperties} data-tone={levTone} data-testid="risk-bill-lev">
            <span className="bl-row">
              <span>{S.lev}</span>
              <b>{x1(sizing.neededLeverage)}×</b>
            </span>
            <span className="bl-bar" aria-hidden="true">
              <i style={{ transform: `scaleX(${levShare.toFixed(3)})` }} />
              <u />
            </span>
            <small>{S.levRule(rule)}</small>
          </div>
          <dl className="bl-rows">
            {rows.map((r, k) => (
              <div key={r.key} style={{ "--k": k + 2 } as React.CSSProperties} data-row={r.key}>
                <dt>{r.label}</dt>
                <dd data-tone={r.tone}>
                  {r.value}
                  {r.sub && <small>{r.sub}</small>}
                </dd>
              </div>
            ))}
          </dl>
        </div>
        {/* a picture of the three prices above: decorative for assistive technology (the numbers stand in the fields and the rows) */}
        <div className="bl-ladder" aria-hidden="true" data-testid="risk-bill-ladder" data-target={tgt != null ? "" : undefined} style={{ height: H }}>
          <span className="bl-zone" data-kind="win" style={{ ...zone(yE, yT), opacity: tgt != null ? 1 : 0 }} />
          <span className="bl-zone" data-kind="loss" style={zone(yE, yS)} />
          <span className="bl-line" data-kind="target" data-below={long ? undefined : ""} style={{ ...line(yT), opacity: tgt != null ? 1 : 0 }}>
            <em>
              {S.ladder.target}
              {bill.target ? ` +${x1(bill.target.rr.rr)} R` : ""} · {tgt != null ? priceText(tgt) : ""}
            </em>
          </span>
          <span className="bl-line" data-kind="entry" style={line(yE)}>
            <em>
              {S.ladder.entry} · {priceText(m.entry)}
            </em>
          </span>
          <span className="bl-line" data-kind="stop" data-below={long ? "" : undefined} style={line(yS)}>
            <em>
              {S.ladder.stop} · {priceText(m.stop)}
            </em>
          </span>
        </div>
      </div>
      <div className="bl-notes" data-testid="risk-bill-notes">
        {bill.notes.map((n) => (
          <p key={n.code} data-tone={n.tone} data-code={n.code}>
            {noteText(n)}
          </p>
        ))}
      </div>
      <ul className="bl-foot">
        <li data-testid="risk-bill-assume">{S.assume(pct(limits.feePct, 2), pct(limits.slippagePct, 2))}</li>
        <li data-testid="risk-bill-step">
          {bill.step.qty > 0 ? S.step(qtyText(bill.step.step), qtyText(bill.step.qty), unit, money(bill.step.loss, cur)) : S.stepNone(qtyText(bill.step.step))}
        </li>
        <li>{S.disclaimer}</li>
      </ul>
    </section>
  );
}
