/**
 * What the Labor does when the user presses "Als neue Version speichern" / "Als Herausforderer live testen" on a proposal –
 * the host side of the panel's contract (`types.ts`). Both run only after that click; neither touches the strategy in the editor:
 *
 * - save: a draft of the lab gets a NEW VERSION (the old one stays in its version list and can be restored); the editor's idea
 *   becomes a NEW draft "… v2". If the draft's rules changed since the proposal was made, nothing is overwritten.
 * - challenger: a virtual forward account (`@/domain/forward`) with the proposal's rules, on new candles, in parallel.
 */
import { customKey } from "@/domain/lab";
import { startAccount } from "@/views/labor/forward/forwardActions";
import { useLabor } from "@/views/labor/laborStore";
import { useVersions } from "@/views/labor/versionsStore";
import type { StoredProposal } from "@/domain/evolve";
import type { EvolveActionResult, StrategyEntry } from "./types";

export const EDITOR_ID = "editor";
export const draftEntryId = (draftId: string): string => `d:${draftId}`;

const when = (ms: number): string => new Date(ms).toLocaleDateString("de-DE");

export function saveProposalAsVersion(entry: StrategyEntry, p: StoredProposal, now: number = Date.now()): EvolveActionResult {
  const lab = useLabor.getState();
  const note = `Vorschlag des Optimierers vom ${when(p.createdAt)}: ${p.changes.slice(0, 3).join("; ")}`.slice(0, 140);
  if (entry.id.startsWith("d:")) {
    const draftId = entry.id.slice(2);
    const draft = lab.drafts.find((d) => d.id === draftId);
    if (!draft) return { ok: false, reason: "Den Entwurf gibt es nicht mehr." };
    if (customKey(draft.config) !== p.baseKey) return { ok: false, reason: "Die Regeln dieses Entwurfs haben sich seit dem Vorschlag geändert – es wird nichts überschrieben. Starte eine neue Runde, damit der Vorschlag zu den heutigen Regeln passt." };
    if (!lab.replaceDraftConfig(draftId, p.config)) return { ok: false, reason: "Der Entwurf konnte nicht aktualisiert werden." };
    const v = useVersions.getState().record(draftId, p.config, note, now);
    return { ok: true, label: v ? `Version ${v.n} von „${draft.name}“` : `„${draft.name}“ (unverändert gespeichert)` };
  }
  const id = lab.addDraft(`${p.baseConfig.name} v2`, p.config, note);
  if (id == null) return { ok: false, reason: "Es gibt schon die höchste Zahl an Entwürfen. Lösche einen, bevor du einen neuen anlegst." };
  const name = useLabor.getState().drafts.find((d) => d.id === id)?.name ?? `${p.baseConfig.name} v2`;
  return { ok: true, label: `neuer Entwurf „${name}“` };
}

export async function startProposalAsChallenger(entry: StrategyEntry, p: StoredProposal, now: number = Date.now()): Promise<EvolveActionResult> {
  const lab = useLabor.getState().cfg;
  const res = await startAccount(
    {
      name: `Herausforderer · ${entry.name}`.slice(0, 60),
      config: p.config,
      signal: entry.signal,
      symbol: entry.symbol,
      capital: lab.capital,
      riskPct: lab.riskPct,
      maxLeverage: lab.maxLeverage,
      exchange: lab.exchange,
      slippage: lab.slippage,
      funding: lab.funding,
      source: { kind: "editor", label: `Herausforderer · ${entry.name}`.slice(0, 80) },
    },
    now,
  );
  return res.ok ? { ok: true, label: "virtuelles Konto im Forward-Test", id: res.id } : { ok: false, reason: res.error };
}
