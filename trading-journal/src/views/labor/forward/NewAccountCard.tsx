/**
 * "Neues virtuelles Konto" (F23): which rules (the editor's current idea, a saved draft or a ready-made template), name, market,
 * start capital, risk per trade and leverage; the costs are the lab's current ones. Starting freezes a copy of the rules.
 */
import { useId, useMemo, useState } from "react";
import { FEE_PRESETS, type SlippageModel } from "@/domain/backtest/index";
import { CUSTOM_TEMPLATES, summarizeCustom, validateCustom, type CustomConfig } from "@/domain/lab";
import { forwardCfgOf, newAccountError, type ForwardSource } from "@/domain/forward";
import { normalizeWatchSymbol } from "@/domain/boxes";
import { sanitizeSignalCfg } from "@/domain/signals";
import { MorphSelect } from "@/motion/pulse/MorphSelect";
import { Button } from "@/primitives/Button";
import { Card } from "@/primitives/Card";
import { Input } from "@/primitives/Input";
import { useJournal } from "@/store/journalStore";
import { pushToast } from "@/store/uiStore";
import { useLabor } from "../laborStore";
import { LABOR } from "../strings";
import { FieldRow } from "../ui";
import { useVersions } from "../versionsStore";
import { startAccount } from "./forwardActions";
import { FORWARD } from "./strings";

const F = FORWARD;

const SLIP_LABEL = (s: SlippageModel): string => (s.kind === "fixed" ? `Slippage fix ${s.bps} bp` : s.kind === "spread" ? `Spread ${s.bps} bp` : s.kind === "atr" ? `Slippage ${Math.round(s.frac * 100)} % ATR` : "ohne Slippage");

function NumField({ label, value, onCommit, suffix, testId }: { label: string; value: number; onCommit: (v: number) => void; suffix: string; testId: string }) {
  const [draft, setDraft] = useState<string | null>(null);
  const id = useId();
  const commit = (): void => {
    if (draft == null) return;
    const v = Number(draft.replace(/\./g, "").replace(",", "."));
    if (Number.isFinite(v) && v > 0) onCommit(v);
    setDraft(null);
  };
  return (
    <FieldRow label={label} htmlFor={id}>
      <span className="relative grid">
        <Input id={id} numeric value={draft ?? String(value).replace(".", ",")} onChange={(e) => setDraft(e.target.value)} onBlur={commit} onKeyDown={(e) => e.key === "Enter" && commit()} className="pr-9 text-[13px]" data-testid={testId} />
        <span aria-hidden="true" className="pointer-events-none absolute inset-y-0 right-3 grid place-items-center text-[11px] text-faint">
          {suffix}
        </span>
      </span>
    </FieldRow>
  );
}

interface Choice {
  value: string;
  label: string;
  config: CustomConfig;
  source: ForwardSource;
}

export function NewAccountCard({ className }: { className?: string }) {
  const lab = useLabor((s) => s.cfg);
  const drafts = useLabor((s) => s.drafts);
  const versions = useVersions((s) => s.map);
  const rawSignals = useJournal((s) => s.settings.signals);
  const rawForward = useJournal((s) => s.settings.forward);
  const accounts = useMemo(() => forwardCfgOf(rawForward).accounts, [rawForward]);
  const uid = useId();
  const [pick, setPick] = useState("editor");
  const [name, setName] = useState<string | null>(null);
  const [symbol, setSymbol] = useState<string | null>(null);
  const [capital, setCapital] = useState<number | null>(null);
  const [risk, setRisk] = useState<number | null>(null);
  const [lev, setLev] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);

  const choices = useMemo<Choice[]>(() => {
    const out: Choice[] = [{ value: "editor", label: F.ruleEditor(lab.custom.name), config: lab.custom, source: { kind: "editor", label: lab.custom.name } }];
    for (const d of drafts) {
      const v = versions[d.id]?.at(-1)?.n ?? undefined;
      out.push({ value: `d:${d.id}`, label: d.origin ? F.ruleForeign(d.name) : F.ruleDraft(d.name, v ?? null), config: d.config, source: { kind: d.origin ? "playbook" : "draft", label: d.name, ...(v ? { versionNo: v } : {}), ...(d.origin ? { foreign: true } : {}) } });
    }
    for (const t of CUSTOM_TEMPLATES) out.push({ value: `t:${t.id}`, label: F.ruleTemplate(t.title), config: t.build(), source: { kind: "template", label: t.title } });
    return out;
  }, [lab.custom, drafts, versions]);
  const choice = choices.find((c) => c.value === pick) ?? choices[0]!;
  const sym = symbol ?? lab.symbol;
  const symNorm = normalizeWatchSymbol(sym);
  const symOk = symNorm != null;
  const capitalV = capital ?? lab.capital;
  const riskV = risk ?? lab.riskPct;
  const levV = lev ?? lab.maxLeverage;
  const problem = useMemo(() => newAccountError({ config: choice.config, symbol: symNorm ?? sym, capital: capitalV, riskPct: riskV, maxLeverage: levV }, accounts), [choice.config, symNorm, sym, capitalV, riskV, levV, accounts]);
  const issues = useMemo(() => validateCustom(choice.config), [choice.config]);
  const lines = useMemo(() => summarizeCustom(choice.config), [choice.config]);
  const fee = FEE_PRESETS.find((p) => p.exchange === lab.exchange)?.label ?? lab.exchange;
  
  const start = async (): Promise<void> => {
    if (busy) return;
    setBusy(true);
    const res = await startAccount({
      name: (name ?? "").trim() || choice.config.name,
      config: choice.config,
      signal: sanitizeSignalCfg(rawSignals),
      symbol: symNorm ?? sym,
      capital: capitalV,
      riskPct: riskV,
      maxLeverage: levV,
      exchange: lab.exchange,
      slippage: lab.slippage,
      funding: lab.funding,
      source: choice.source,
    });
    setBusy(false);
    if (res.ok) {
      pushToast({ kind: "success", title: F.started, detail: F.startedDetail });
      setName(null);
    } else pushToast({ kind: "error", title: F.failed, detail: res.error });
  };

  return (
    <Card title={F.newTitle} className={className} data-testid="forward-new">
      <div className="grid gap-4">
        <div className="grid gap-4 sm:grid-cols-2">
          <FieldRow label={F.rules} htmlFor={`${uid}-rules`}>
            <MorphSelect id={`${uid}-rules`} value={choice.value} onChange={setPick} options={choices.map((c) => ({ value: c.value, label: c.label }))} wrap data-testid="forward-rules" />
          </FieldRow>
          <FieldRow label={F.name} htmlFor={`${uid}-name`}>
            <Input id={`${uid}-name`} value={name ?? choice.config.name} maxLength={60} onChange={(e) => setName(e.target.value)} autoComplete="off" spellCheck={false} data-testid="forward-name" />
          </FieldRow>
        </div>

        <div className="rounded-xl border border-line bg-ink-950/50 p-3" data-testid="forward-rules-text">
          <ul className="grid gap-1 text-[12.5px] leading-relaxed text-fg/85">
            {lines.map((l) => (
              <li key={l}>{l}</li>
            ))}
          </ul>
          {issues.some((i) => i.level === "error") && <p className="mt-2 text-[12px] text-(--color-danger-text)">{issues.find((i) => i.level === "error")!.text}</p>}
        </div>

        <div className="grid gap-3 sm:grid-cols-4">
          <FieldRow label={F.market} htmlFor={`${uid}-sym`} hint={!symOk ? <span className="text-(--color-danger-text)">{LABOR.symbolInvalid}</span> : undefined}>
            <Input id={`${uid}-sym`} value={sym} onChange={(e) => setSymbol(e.target.value.toUpperCase())} className="font-mono uppercase" autoComplete="off" spellCheck={false} data-testid="forward-symbol" />
          </FieldRow>
          <NumField label={F.capital} value={capitalV} onCommit={setCapital} suffix="USDT" testId="forward-capital" />
          <NumField label={F.risk} value={riskV} onCommit={setRisk} suffix="%" testId="forward-risk" />
          <NumField label={F.leverage} value={levV} onCommit={setLev} suffix="×" testId="forward-leverage" />
        </div>

        <p className="text-[12px] leading-relaxed text-mute" data-testid="forward-costs">
          {F.costs(fee, SLIP_LABEL(lab.slippage), LABOR.fundingModes[lab.funding])} {F.costsHint}
        </p>

        <div className="flex flex-wrap items-center justify-between gap-3">
          <p className="max-w-[60ch] text-[12px] text-faint" aria-live="polite" data-testid="forward-problem">
            {problem ?? F.freeze}
          </p>
          <Button variant="primary" onClick={() => void start()} disabled={busy || !!problem || !symOk} data-testid="forward-start">
            {busy ? F.starting : F.start}
          </Button>
        </div>
      </div>
    </Card>
  );
}
