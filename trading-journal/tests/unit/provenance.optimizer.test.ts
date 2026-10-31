/**
 * F24: the optimiser writes ONE line of the KI-Protokoll per proposal – at the first decision (saved / challenger = übernommen,
 * rejected = nicht übernommen), no model (a search, not a language model), the proposal's id as the only reference.
 */
import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { withEvolve } from "@/domain/evolve";
import { aiLogOfSettings } from "@/domain/provenance";
import { useJournal } from "@/store/journalStore";
import { decideProposal } from "@/views/evolve/actions";
import { bootFixtureJournal, installDomPolyfills } from "./views.overview.harness";
import { realProposals } from "./evolve.helpers";

describe("Optimierer → KI-Protokoll", { timeout: 120_000 }, () => {
  beforeAll(() => installDomPolyfills());
  beforeEach(async () => {
    await bootFixtureJournal();
  });

  async function seed() {
    const props = realProposals(2);
    const { settings, saveSettings } = useJournal.getState();
    await saveSettings({ ...settings, evolve: withEvolve(settings.evolve, { proposals: props }) });
    return props;
  }
  const log = () => aiLogOfSettings(useJournal.getState().settings).entries;

  it("eine Ablehnung ist „nicht übernommen“, ohne Modell, mit der Id des Vorschlags", async () => {
    const [p] = await seed();
    expect(await decideProposal(p!.id, { decision: "rejected", reason: "zu wenig Trades" }, 77_000)).toBe(true);
    await new Promise((r) => setTimeout(r, 30));
    expect(log()).toHaveLength(1);
    expect(log()[0]).toMatchObject({ helper: "optimizer", model: null, version: null, adopted: false, ref: p!.id, at: 77_000 });
    // der Grund der Ablehnung ist Text des Händlers und gehört nicht ins Protokoll
    expect(JSON.stringify(useJournal.getState().settings.aiLog)).not.toContain("zu wenig Trades");
  });

  it("Speichern ist „übernommen“; ein späterer Schritt desselben Vorschlags (Herausforderer) schreibt keine zweite Zeile", async () => {
    const [p] = await seed();
    await decideProposal(p!.id, { decision: "saved", savedAs: "Version 2" }, 80_000);
    await new Promise((r) => setTimeout(r, 30));
    await decideProposal(p!.id, { decision: "challenger", challengerId: "f_1" }, 81_000);
    await new Promise((r) => setTimeout(r, 30));
    expect(log()).toHaveLength(1);
    expect(log()[0]).toMatchObject({ adopted: true, at: 80_000 });
  });

  it("ein unbekannter Vorschlag schreibt nichts", async () => {
    await seed();
    expect(await decideProposal("ev_gibtsnicht", { decision: "rejected" }, 5)).toBe(true);
    await new Promise((r) => setTimeout(r, 30));
    expect(log()).toEqual([]);
  });
});
