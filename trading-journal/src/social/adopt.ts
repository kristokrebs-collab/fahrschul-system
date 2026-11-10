/**
 * Adopting a shared Entscheidungsgrundlage (P12): a `SharedSetup` becomes a NEW local setup (fresh ids, no stats, no
 * example trades) – the recipient's journal is only touched when they press "Als Grundlage übernehmen".
 */
import type { Settings, Setup } from "@/domain/types";
import { EMPTY_AUTO, withStrategy } from "@/domain/strategy/types";
import { newId } from "@/lib/ids";
import type { SharedSetup } from "./contract";

/** A unique name among the existing setups ("Breakout" → "Breakout (geteilt)" → "Breakout (geteilt 2)"). */
export function uniqueSetupName(name: string, existing: readonly Pick<Setup, "name">[]): string {
  const taken = new Set(existing.map((s) => s.name.trim().toLocaleLowerCase("de-DE")));
  if (!taken.has(name.trim().toLocaleLowerCase("de-DE"))) return name.trim();
  for (let i = 1; i < 100; i++) {
    const candidate = `${name.trim()} (geteilt${i > 1 ? ` ${i}` : ""})`;
    if (!taken.has(candidate.toLocaleLowerCase("de-DE"))) return candidate;
  }
  return `${name.trim()} (${Date.now().toString(36)})`;
}

/** The new local setup built from a shared one. */
export function setupFromShared(p: SharedSetup, existing: readonly Pick<Setup, "name">[], id: (prefix: string) => string = newId): Setup {
  const base: Setup = {
    id: id("s_"),
    name: uniqueSetupName(p.name, existing),
    account: p.account,
    color: p.color,
    desc: p.desc,
    checklist: p.checklist.map((text) => ({ id: id("c"), text })),
  };
  return withStrategy(base, {
    entryCriteria: p.entryCriteria.map((text) => ({ id: id("k"), text })),
    exitCriteria: p.exitCriteria.map((text) => ({ id: id("k"), text })),
    riskModel: p.risk ?? { riskPct: null, maxLeverage: null, minRR: null, stop: null },
    tags: [...p.tags],
    examples: [],
    markets: [...p.markets],
    tf: [...p.tf],
    auto: { ...EMPTY_AUTO, boxKinds: [], sessions: [], sides: [] },
  });
}

/** Settings with the shared setup appended (pure – the caller saves). */
export function withAdoptedSetup(settings: Settings, p: SharedSetup, id?: (prefix: string) => string): { settings: Settings; setup: Setup } {
  const setup = setupFromShared(p, settings.setups, id);
  return { settings: { ...settings, setups: [...settings.setups, setup] }, setup };
}
