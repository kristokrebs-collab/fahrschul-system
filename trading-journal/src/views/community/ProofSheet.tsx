import { useId, useMemo, useState, type ReactNode } from "react";
import { cn } from "@/lib/cn";
import { MorphSelect } from "@/motion/pulse/MorphSelect";
import { Sheet } from "@/motion/Sheet";
import { StaggerItem } from "@/motion/Stagger";
import { Field } from "@/primitives/Field";
import { Input } from "@/primitives/Input";
import { Segmented } from "@/primitives/Segmented";
import { useEnriched, useJournal } from "@/store/journalStore";
import { PROOF_BASES, PROOF_MAX_TRADES, type ProofBasis } from "@/social/contract";
import { fmtDd, fmtR, ORIGIN_LABEL } from "@/social/format";
import { BASIS_HINT, proofFigures } from "@/social/proof";
import { buildProof, dayAgo, journalSpan } from "@/social/proofBuild";
import { BASIS_FULL, PROOF } from "@/social/proofStrings";
import { closeSheet, useSocial } from "@/social/store";
import { LinkPart } from "@/social/ui/ShareSheet";
import { Glyph } from "@/social/ui/glyphs";

type Preset = "30" | "90" | "180" | "365" | "all" | "custom";
type Scope = "all" | "setup";

/** Local calendar day `YYYY-MM-DD` of `now`. */
const today = (now: Date): string => dayAgo(now, 0);

function Row({ k, v, tone }: { k: string; v: string; tone?: "loss" }) {
  return (
    <div className="contents">
      <dt className="text-faint">{k}</dt>
      <dd className={cn("num truncate text-right text-fg", tone === "loss" && "text-loss")}>{v}</dd>
    </div>
  );
}

function Section({ title, children, testId }: { title: string; children: ReactNode; testId?: string }) {
  return (
    <StaggerItem as="section" className="grid gap-3 rounded-2xl border border-line bg-ink-900/60 p-4" data-testid={testId}>
      <h3 className="label">{title}</h3>
      {children}
    </StaggerItem>
  );
}

/**
 * The builder of an Ergebnisbeleg (F57): name, kind of results (the trader's word), period, all trades or one Grundlage,
 * optionally "Fortschreibung von" an earlier proof – and a preview of exactly what the page will state. The proof is
 * built on the device (`buildProof`); only the link creation talks to the server. Mounted once at the page root by
 * `CommunitySheets` like the other Community sheets.
 */
export function ProofSheet() {
  const open = useSocial((s) => s.sheet?.kind === "proof");
  return (
    <Sheet open={open} onClose={closeSheet} title={PROOF.sheetTitle} size="md" dismissGuard={false}>
      {open && <Body />}
    </Sheet>
  );
}

function Body() {
  const trades = useEnriched();
  const setups = useJournal((s) => s.settings.setups);
  const shares = useSocial((s) => s.shares.data);
  const [now] = useState(() => new Date());
  const span = useMemo(() => journalSpan(trades), [trades]);
  const [strategy, setStrategy] = useState("");
  const [basis, setBasis] = useState<ProofBasis>("live");
  const [preset, setPreset] = useState<Preset>("90");
  const [from, setFrom] = useState(() => dayAgo(now, 90));
  const [to, setTo] = useState(() => today(now));
  const [scope, setScope] = useState<Scope>("all");
  const [setupId, setSetupId] = useState(setups[0]?.id ?? "");
  const [prev, setPrev] = useState("");
  const nameId = useId();
  const fromId = useId();
  const toId = useId();

  const pickPreset = (p: Preset) => {
    setPreset(p);
    setTo(today(now));
    setFrom(p === "all" ? (span?.first ?? dayAgo(now, 90)) : dayAgo(now, Number(p)));
  };
  const proofs = (shares ?? []).filter((s) => s.kind === "proof" && !s.revoked && (!s.expiresAt || Date.parse(s.expiresAt) > now.getTime()));
  const chosenSetup = scope === "setup" ? (setups.find((s) => s.id === setupId)?.id ?? setups[0]?.id ?? null) : null;
  const name = strategy.trim() || (scope === "setup" ? (setups.find((s) => s.id === chosenSetup)?.name ?? "") : "");

  const built = useMemo(
    () => buildProof(trades, setups, { strategy: name, basis, from, to, setupId: chosenSetup, prev: prev || null }),
    [trades, setups, name, basis, from, to, chosenSetup, prev],
  );
  const fig = built.ok ? proofFigures(built.payload) : null;
  const error = built.ok
    ? null
    : built.reason === "tooMany"
      ? PROOF.errors.tooMany(built.count ?? 0, PROOF_MAX_TRADES)
      : built.reason === "strategy"
        ? null // asked for by the field, not shouted at while the page is still empty
        : PROOF.errors[built.reason];
  const key = built.ok ? JSON.stringify(built.payload) : "";

  if (!span) return <p className="text-[13px] text-mute">{PROOF.noTrades}</p>;
  return (
    <div className="grid gap-3" data-testid="proof-sheet">
      <StaggerItem>
        <p className="text-[13px] leading-relaxed text-mute">{PROOF.lead}</p>
      </StaggerItem>

      <Section title={PROOF.strategy}>
        <Field label={PROOF.strategy} htmlFor={nameId} help={PROOF.strategyHint} className="[&>label]:sr-only">
          <Input id={nameId} value={strategy} maxLength={60} onChange={(e) => setStrategy(e.target.value)} placeholder={PROOF.strategyPlaceholder} data-testid="proof-name" />
        </Field>
        <div className="grid gap-1.5">
          <span className="label">{PROOF.basis}</span>
          <Segmented<ProofBasis> aria-label={PROOF.basis} options={PROOF_BASES.map((b) => ({ v: b, label: BASIS_FULL[b] }))} value={basis} onChange={setBasis} className="w-full" />
          <span className="text-[12px] leading-snug text-mute" data-testid="proof-basis-hint">
            {BASIS_HINT[basis]} {PROOF.basisHint}
          </span>
        </div>
      </Section>

      <Section title={PROOF.period}>
        <Segmented<Preset> size="sm" aria-label={PROOF.period} options={PROOF.presets.map((p) => ({ v: p.v, label: p.label }))} value={preset} onChange={pickPreset} className="w-full" />
        <div className="grid grid-cols-2 gap-3">
          <Field label={PROOF.from} htmlFor={fromId}>
            <Input id={fromId} type="date" value={from} max={to} onChange={(e) => {
              setPreset("custom");
              setFrom(e.target.value);
            }} data-testid="proof-from" />
          </Field>
          <Field label={PROOF.to} htmlFor={toId}>
            <Input id={toId} type="date" value={to} min={from} onChange={(e) => {
              setPreset("custom");
              setTo(e.target.value);
            }} data-testid="proof-to" />
          </Field>
        </div>
      </Section>

      <Section title={PROOF.scope}>
        <Segmented<Scope> size="sm" aria-label={PROOF.scope} options={[{ v: "all", label: PROOF.scopeAll }, { v: "setup", label: PROOF.scopeSetup, disabled: !setups.length }]} value={scope} onChange={setScope} />
        {scope === "setup" && setups.length > 0 && (
          <MorphSelect<string> aria-label={PROOF.pickSetup} value={chosenSetup ?? ""} onChange={setSetupId} options={setups.map((s) => ({ value: s.id, label: s.name }))} size="sm" className="w-full" />
        )}
        <p className="text-[12px] leading-snug text-mute">{PROOF.scopeHint}</p>
        {proofs.length > 0 && (
          <div className="grid gap-1.5 border-t border-line pt-3">
            <span className="label">{PROOF.prev}</span>
            <MorphSelect<string>
              aria-label={PROOF.prev}
              value={prev}
              onChange={setPrev}
              options={[{ value: "", label: PROOF.prevNone }, ...proofs.map((p) => ({ value: p.token, label: `${p.title} · ${new Date(p.createdAt).toLocaleDateString("de-DE")}` }))]}
              size="sm"
              className="w-full"
            />
            <p className="text-[12px] leading-snug text-mute">{PROOF.prevHint}</p>
          </div>
        )}
      </Section>

      <Section title={PROOF.preview} testId="proof-preview">
        {fig && built.ok ? (
          <>
            <dl className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-4 gap-y-1 text-[12.5px]">
              <Row k={PROOF.rows.trades} v={String(fig.n)} />
              <Row k={PROOF.rows.scored} v={String(fig.scored)} />
              <Row k={PROOF.rows.sum} v={fmtR(fig.sumR)} />
              <Row k={PROOF.rows.drawdown} v={fmtDd(fig.maxDrawdownR)} tone={fig.maxDrawdownR > 0 ? "loss" : undefined} />
              <Row k={PROOF.rows.costs} v={`${fig.costs.known} / ${fig.n}`} />
              <Row k={PROOF.rows.origin} v={fig.dataClass ? ORIGIN_LABEL[fig.dataClass] : "–"} />
            </dl>
            {built.payload.scope.only != null && (
              <p className="text-[12px] leading-snug text-mute">
                {fig.n} von {built.payload.scope.inPeriod} geschlossenen Trades des Zeitraums (nur „{built.payload.scope.only}“).
              </p>
            )}
          </>
        ) : (
          <p className={cn("text-[12.5px] leading-snug", error ? "text-warn" : "text-mute")} role={error ? "alert" : undefined} data-testid="proof-error">
            {error ?? PROOF.errors.strategy}
          </p>
        )}
        <p className="flex items-start gap-2 text-[12px] leading-snug text-faint">
          <Glyph name="lock" className="mt-0.5 size-3.5 shrink-0" />
          {PROOF.never}
        </p>
      </Section>

      <Section title="Link">
        {built.ok ? (
          <>
            <p className="text-[12px] leading-snug text-mute">{PROOF.consent}</p>
            <LinkPart key={key} payload={built.payload} />
          </>
        ) : (
          <p className="text-[12.5px] text-mute">{PROOF.errors.strategy}</p>
        )}
      </Section>
    </div>
  );
}
