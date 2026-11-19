/**
 * "Weitere Werkzeuge": the two slot panels other tools fill – pattern discovery and the background optimiser – and the
 * proposal they may make. A panel only PROPOSES; the studio shows exactly what would change in the rules and applies it
 * after one explicit "Übernehmen". Both panels load lazily (`Slots.tsx`) and get the strategy, the candles of the last
 * backtest, its result and the number of strategies tried so far (the multiple-testing count of anything that searches).
 */
import { Suspense, useMemo } from "react";
import { diffConfigs } from "@/domain/lab/versions";
import { summarizeCustom } from "@/domain/lab";
import { Button } from "@/primitives/Button";
import { Card } from "@/primitives/Card";
import { resolveEditor } from "./resolve";
import { DiscoveryPanel, EvolvePanel } from "./Slots";
import { strategyView, useStudio } from "./studioStore";
import { STUDIO } from "./strings";
import { Disclaimer, Mini } from "./ui";
import type { StoredStrategy } from "@/domain/strategytext";

const P = STUDIO.proposal;

function Proposal() {
  const proposal = useStudio((s) => s.proposal);
  const parsed = useStudio((s) => s.parsed);
  const editor = useStudio((s) => s.editor);
  const current = useMemo(() => (proposal ? resolveEditor(editor, parsed, []).config : null), [proposal, editor, parsed]);
  const diff = useMemo(() => (proposal && current ? diffConfigs(current, { ...proposal.config, name: current.name }) : []), [proposal, current]);
  if (!proposal) return null;
  return (
    <div className="grid gap-3 rounded-xl border border-white/20 bg-white/[0.04] p-4" role="group" aria-label={P.title} data-testid="studio-proposal">
      <Mini>{P.title}</Mini>
      <p className="text-[13px] leading-snug text-fg">{proposal.note}</p>
      {diff.length > 0 && (
        <ul className="grid gap-1 text-[12.5px] text-fg/90" aria-label="Was sich ändert">
          {diff.map((d) => (
            <li key={d}>{d}</li>
          ))}
        </ul>
      )}
      <ul className="grid gap-1 text-[12px] text-mute" aria-label="Die neuen Regeln">
        {summarizeCustom(proposal.config).map((l) => (
          <li key={l}>{l}</li>
        ))}
      </ul>
      <p className="text-[11.5px] text-faint">{P.note}</p>
      <div className="flex flex-wrap gap-2">
        <Button variant="primary" onClick={() => useStudio.getState().applyProposal()} data-testid="studio-proposal-apply">
          {P.apply}
        </Button>
        <Button onClick={() => useStudio.getState().dismissProposal()} data-testid="studio-proposal-dismiss">
          {P.dismiss}
        </Button>
      </div>
    </div>
  );
}

export function MoreTools({ strategies, className }: { strategies: StoredStrategy[]; className?: string }) {
  const editor = useStudio((s) => s.editor);
  const parsed = useStudio((s) => s.parsed);
  const bt = useStudio((s) => s.bt);
  const tried = useStudio((s) => s.tried.length);
  const st = strategies.find((s) => s.id === editor.id);
  const strategy = useMemo(() => strategyView(editor, parsed, st?.versions ?? []), [editor, parsed, st]);
  const run = bt.run && bt.forId === editor.id ? bt.run : null;
  const onPropose = useStudio.getState().propose;
  const props = { strategy, candles: run?.bars ?? null, result: run?.result ?? null, trials: tried, onPropose };
  const fallback = <p className="text-[12.5px] text-faint">{STUDIO.more.loading}</p>;
  return (
    <Card className={className} data-testid="studio-more">
      <div className="grid gap-4">
        <Proposal />
        <div className="grid gap-4 lg:grid-cols-2">
          <Suspense fallback={fallback}>
            <DiscoveryPanel {...props} />
          </Suspense>
          <Suspense fallback={fallback}>
            <EvolvePanel {...props} />
          </Suspense>
        </div>
        <Disclaimer past />
      </div>
    </Card>
  );
}
