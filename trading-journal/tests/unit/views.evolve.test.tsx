/**
 * Optimiser panel – the user's side on REAL BTCUSDT candles: the standing note, the strategies, a run to proposals / an honest
 * "nothing found", pause and stop, several strategies and the tournament, the three decisions per proposal (save / challenger /
 * reject with a reason) and what they write into `settings.evolve`, the live check of a challenger, the learning card with
 * its honesty below the minimum sample, the trial-log drawer, and loading missing candles on demand.
 */
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { evolveCfgOf, withEvolve, type StoredProposal } from "@/domain/evolve";
import { emptyCursor, newAccount, withAccounts } from "@/domain/forward";
import { sanitizeCustom, defaultCustom, newGroup, newLeaf } from "@/domain/lab";
import { DEFAULT_SIGNAL_CFG } from "@/domain/signals";
import { MorphDialogProvider } from "@/motion/MorphDialog";
import { MotionRoot } from "@/motion/MotionRoot";
import { useJournal } from "@/store/journalStore";
import { __resetEvolve } from "@/views/evolve/evolveStore";
import { EvolvePanel } from "@/views/evolve/EvolvePanel";
import type { CandleSet, EvolvePanelProps, StrategyEntry } from "@/views/evolve/types";
import { bootFixtureJournal, installDomPolyfills } from "./views.overview.harness";
import { baseRules, DATA, ENGINE, FROM_MS, H4, path, realProposals, weakRules } from "./evolve.helpers";

const TO = (H4.at(-1)!.t + 14_400) * 1000;
const SET: CandleSet = { data: DATA, fromMs: FROM_MS, toMs: TO, loadedAt: TO, source: "Binance USDⓈ-M" };
const entry = (id: string, name: string, over: Partial<StrategyEntry> = {}): StrategyEntry => ({ id, name, config: baseRules(), symbol: "BTCUSDT", signal: DEFAULT_SIGNAL_CFG, engine: ENGINE, ...over });

const evolveNow = () => evolveCfgOf(useJournal.getState().settings.evolve);

async function seedEvolve(props: StoredProposal[], extra: Record<string, unknown> = {}): Promise<void> {
  const { settings, saveSettings } = useJournal.getState();
  await saveSettings({ ...settings, evolve: { ...withEvolve(settings.evolve, { proposals: props }), ...extra } });
}

function renderPanel(over: Partial<EvolvePanelProps> = {}) {
  const onSave = vi.fn(() => ({ ok: true as const, label: "Version 3 von „Test“" }));
  const onChallenger = vi.fn(async () => ({ ok: true as const, label: "virtuelles Konto", id: "f_test1" }));
  const props: EvolvePanelProps = {
    strategies: [entry("s1", "Test-Idee")],
    candles: { s1: SET },
    onSaveVersion: onSave,
    onStartChallenger: onChallenger,
    budget: 30,
    seed: 4242,
    ...over,
  };
  const ui = (p: EvolvePanelProps) => (
    <MotionRoot>
      <MorphDialogProvider>
        <EvolvePanel {...p} />
      </MorphDialogProvider>
    </MotionRoot>
  );
  const r = render(ui(props));
  return { ...r, onSave, onChallenger, rerenderWith: (next: Partial<EvolvePanelProps>) => r.rerender(ui({ ...props, ...next })) };
}

beforeAll(() => {
  installDomPolyfills();
  HTMLCanvasElement.prototype.getContext = (() => null) as unknown as typeof HTMLCanvasElement.prototype.getContext;
  window.scrollTo = vi.fn() as never;
});

beforeEach(async () => {
  await bootFixtureJournal();
  localStorage.clear();
  __resetEvolve();
});

describe("Optimierer · Aufbau", { timeout: 60_000 }, () => {
  it("sagt immer, dass er nur bei offener App läuft und nie von selbst ändert; Haftungshinweis an jeder Karte", () => {
    renderPanel();
    const note = screen.getByTestId("evolve-open-note");
    expect(note).toHaveTextContent("Läuft nur, solange die App offen ist.");
    expect(note).toHaveTextContent(/Ändert nie von selbst/);
    expect(note).toHaveTextContent(/Es werden keine Orders gesendet/);
    expect(screen.getByTestId("evolve-panel")).toHaveAttribute("data-status", "idle");
    // Hauptkarte und Lernkarte tragen den Satz
    for (const card of [screen.getByTestId("evolve-panel").querySelector('[data-testid="evolve-disclaimer"]')!, within(screen.getByTestId("evolve-learned")).getByTestId("evolve-disclaimer")]) {
      expect(card).toHaveTextContent("Vergangene Ergebnisse sind keine Prognose. Keine professionelle Finanzberatung.");
    }
  });

  it("zeigt die Strategie mit Freiheitsgraden, früheren Versuchen und Kerzen; eine unbrauchbare ist gesperrt – mit Grund", () => {
    const empty = sanitizeCustom({ ...defaultCustom(), name: "Leer", long: newGroup("g1", "and", []) });
    renderPanel({ strategies: [entry("s1", "Test-Idee"), entry("s2", "Leer", { config: empty })], candles: { s1: SET } });
    const rows = screen.getAllByTestId("evolve-strategy");
    expect(rows).toHaveLength(2);
    expect(rows[0]).toHaveTextContent("Test-Idee");
    expect(rows[0]).toHaveTextContent("7 Freiheitsgrade");
    expect(rows[0]).toHaveTextContent("noch keine früheren Versuche");
    expect(rows[0]).toHaveTextContent(/1\d{3} Kerzen bis/);
    expect(rows[1]).toHaveAttribute("data-on", "no");
    expect(rows[1]).toHaveTextContent(/Läuft so nicht:/);
    expect(within(rows[1]!).getByRole("checkbox")).toBeDisabled();
  });

  it("ohne gewählte Strategie lässt sich nichts starten", () => {
    renderPanel({ defaultSelected: [] });
    expect(screen.getByTestId("evolve-start")).toBeDisabled();
    expect(screen.getByText("Wähle mindestens eine Strategie.")).toBeInTheDocument();
  });

  it("fehlende Kerzen werden angefordert; sobald sie da sind, startet der Lauf von allein", async () => {
    const onLoad = vi.fn();
    const r = renderPanel({ candles: {}, onLoadCandles: onLoad });
    fireEvent.click(screen.getByTestId("evolve-start"));
    expect(onLoad).toHaveBeenCalledWith(["s1"]);
    expect(screen.getByTestId("evolve-panel")).toHaveAttribute("data-status", "idle");
    r.rerenderWith({ candles: { s1: SET } });
    await waitFor(() => expect(screen.getByTestId("evolve-panel")).not.toHaveAttribute("data-status", "idle"), { timeout: 10_000 });
    await waitFor(() => expect(screen.getByTestId("evolve-panel")).toHaveAttribute("data-status", "done"), { timeout: 30_000 });
  });

  it("scheitern die Kerzen, startet nichts – und der Grund steht da", async () => {
    const onLoad = vi.fn();
    const r = renderPanel({ candles: {}, onLoadCandles: onLoad });
    fireEvent.click(screen.getByTestId("evolve-start"));
    r.rerenderWith({ candleStatus: { s1: { state: "error", message: "Binance ist gerade nicht erreichbar." } } });
    expect(await screen.findByRole("alert")).toHaveTextContent("Binance ist gerade nicht erreichbar.");
    expect(screen.getByTestId("evolve-panel")).toHaveAttribute("data-status", "idle");
  });
});

describe("Optimierer · ein Lauf", { timeout: 90_000 }, () => {
  it("läuft bis zum Ende: Fortschritt, Bestenliste mit Fenstern und Referenz, Protokoll – und nichts wurde verändert", async () => {
    const { onSave, onChallenger } = renderPanel();
    fireEvent.click(screen.getByTestId("evolve-start"));
    await waitFor(() => expect(screen.getByTestId("evolve-panel")).toHaveAttribute("data-status", "done"), { timeout: 60_000 });
    expect(screen.getByTestId("evolve-trials")).toHaveTextContent("Versuch 30 von 30");
    expect(screen.getByRole("progressbar")).toHaveAttribute("aria-valuenow", "100");
    // die Bestenliste misst auf Testfenstern: Fensterleiste mit Training, 4 Tests und Bestätigung
    const strip = screen.getByTestId("evolve-windows");
    expect(strip).toHaveTextContent("Training");
    expect(strip).toHaveTextContent("Test 4");
    expect(strip).toHaveTextContent("Bestätigung");
    expect(screen.getByTestId("evolve-base-row")).toHaveTextContent("Jetzige Version");
    // Protokoll: jede getestete Variante ist gezählt (30 + Nachbarwerte der Finalisten)
    const open = screen.getByTestId("evolve-protocol-open");
    expect(open).toHaveTextContent(/Versuchsprotokoll \(\d+\)/);
    expect(Number(/\((\d+)\)/.exec(open.textContent!)![1])).toBeGreaterThanOrEqual(30);
    // der Lauf rief weder „speichern“ noch „Herausforderer“
    expect(onSave).not.toHaveBeenCalled();
    expect(onChallenger).not.toHaveBeenCalled();
    // und er zählt seine Versuche je Strategie mit (für die Mehrfachtest-Korrektur künftiger Läufe)
    await waitFor(() => expect(evolveNow().lineages.s1?.trials).toBe(30));
    // entweder Vorschläge, oder die ehrliche Meldung, dass nichts Besseres gefunden wurde
    await waitFor(() => expect(screen.queryAllByTestId("evolve-proposal").length + screen.queryAllByTestId("evolve-nothing").length).toBeGreaterThan(0));
  });

  it("Pausieren hält an (Status, nichts mehr gerechnet), Fortsetzen geht weiter, „Beenden und auswerten“ liefert das Ergebnis", async () => {
    renderPanel({ budget: 1000 });
    fireEvent.click(screen.getByTestId("evolve-start"));
    const panel = screen.getByTestId("evolve-panel");
    await waitFor(() => expect(panel).toHaveAttribute("data-status", "running"), { timeout: 20_000 });
    await waitFor(() => expect(screen.getByTestId("evolve-trials")).toBeInTheDocument(), { timeout: 20_000 });
    fireEvent.click(screen.getByTestId("evolve-pause"));
    await waitFor(() => expect(panel).toHaveAttribute("data-status", "paused"));
    expect(screen.getByTestId("evolve-throttle")).toHaveTextContent(/Pausiert – es wird nichts gerechnet/);
    const frozen = screen.getByTestId("evolve-trials").textContent;
    await new Promise((r) => setTimeout(r, 250));
    expect(screen.getByTestId("evolve-trials").textContent).toBe(frozen);
    fireEvent.click(screen.getByTestId("evolve-resume"));
    await waitFor(() => expect(panel).toHaveAttribute("data-status", "running"));
    fireEvent.click(screen.getByTestId("evolve-stop"));
    await waitFor(() => expect(panel).toHaveAttribute("data-status", "done"), { timeout: 60_000 });
    const n = Number(/Versuch (\d+) von/.exec(screen.getByTestId("evolve-trials").textContent!)![1]);
    expect(n).toBeLessThan(1000); // beendet, nicht ausgeschöpft: Fortschritt zeigt das Budget als verbraucht
  });

  it("Verwerfen bricht ab und lässt nichts zurück", async () => {
    renderPanel({ budget: 1000 });
    fireEvent.click(screen.getByTestId("evolve-start"));
    await waitFor(() => expect(screen.getByTestId("evolve-panel")).toHaveAttribute("data-status", "running"), { timeout: 20_000 });
    fireEvent.click(screen.getByTestId("evolve-abort"));
    await waitFor(() => expect(screen.getByTestId("evolve-panel")).toHaveAttribute("data-status", "idle"));
    expect(screen.queryByTestId("evolve-progress")).toBeNull();
    expect(evolveNow().proposals).toEqual([]);
    expect(evolveNow().lineages).toEqual({});
  });

  it("zwei Strategien laufen zusammen: je eine Bestenliste, ein Turnier mit der Mehrfachtest-Erklärung über alle", async () => {
    const other = entry("s2", "Zweite Idee", { config: sanitizeCustom({ ...baseRules(), long: newGroup("g1", "and", [{ ...newLeaf("n1", "rsi"), params: { len: 10, mode: "below", level: 35, within: 1 } }]) }) });
    renderPanel({ strategies: [entry("s1", "Test-Idee"), other], candles: { s1: SET, s2: SET }, defaultSelected: ["s1", "s2"], budget: 25 });
    fireEvent.click(screen.getByTestId("evolve-start"));
    await waitFor(() => expect(screen.getByTestId("evolve-panel")).toHaveAttribute("data-status", "done"), { timeout: 60_000 });
    expect(screen.getAllByTestId("evolve-leaderboard")).toHaveLength(2);
    expect(screen.getAllByTestId("evolve-strategy-progress")).toHaveLength(2);
    const t = await screen.findByTestId("evolve-tournament");
    expect(t).toHaveTextContent("Test-Idee");
    expect(t).toHaveTextContent("Zweite Idee");
    expect(t).toHaveTextContent(/nach allen 50 Varianten dieser Runde aus 2 Strategien/);
    expect(t).toHaveTextContent("Keine professionelle Finanzberatung");
    expect(within(t).getAllByTestId("evolve-tournament-row").some((r) => r.textContent!.includes("Jetzige Version"))).toBe(true);
  });
});

describe("Optimierer · Vorschläge entscheiden", { timeout: 90_000 }, () => {
  const props = realProposals(3);
  const rules = (id = "s") => entry(id, "Schwach", { config: weakRules(), symbol: "TESTUSDT" });

  it("jede Karte zeigt v1 gegen v2 auf den Testfenstern, das Bestätigungsfenster, die Überanpassungs-Wahrscheinlichkeit, Stichprobe und den Haftungssatz", async () => {
    expect(props.length).toBeGreaterThan(0);
    await seedEvolve(props);
    renderPanel({ strategies: [rules()], candles: {} });
    const cards = await screen.findAllByTestId("evolve-proposal");
    expect(cards).toHaveLength(props.length);
    const c = cards[0]!;
    expect(c).toHaveAttribute("data-decision", "open");
    expect(within(c).getByTestId("evolve-changes").querySelectorAll("li").length).toBeGreaterThan(0);
    expect(within(c).getByTestId("evolve-overfit-p")).toHaveTextContent(/^\d+ %$/);
    expect(within(c).getByTestId("evolve-overfit")).toHaveTextContent(/Chance, dass ein so gutes Ergebnis nach 150 getesteten Varianten/);
    expect(within(c).getByTestId("evolve-holdout")).toHaveTextContent(/Bestätigungsfenster/);
    expect(within(c).getByTestId("evolve-plateau")).toHaveTextContent(/von \d+ Nachbarwerten sind ähnlich gut/);
    expect(within(c).getByTestId("evolve-better")).toHaveTextContent(/In \d von 4 Testfenstern besser/);
    expect(within(c).getByText("Testfenster")).toBeInTheDocument();
    expect(within(c).getByTestId("evolve-disclaimer")).toHaveTextContent("Vergangene Ergebnisse sind keine Prognose. Keine professionelle Finanzberatung.");
    // die drei Entscheidungen sind da
    expect(within(c).getByTestId("evolve-save")).toHaveTextContent("Als neue Version speichern");
    expect(within(c).getByTestId("evolve-challenger")).toHaveTextContent("Als Herausforderer live testen");
    expect(within(c).getByTestId("evolve-reject")).toHaveTextContent("Ablehnen");
  });

  it("„Als neue Version speichern“: der Host bekommt GENAU diesen Vorschlag; erst danach steht er als gespeichert da und zählt als angenommen", async () => {
    await seedEvolve(props);
    const { onSave, onChallenger } = renderPanel({ strategies: [rules()], candles: {} });
    const card = (await screen.findAllByTestId("evolve-proposal"))[1]!;
    const id = card.getAttribute("data-id")!;
    expect(evolveNow().proposals.find((p) => p.id === id)!.decision).toBe("open");
    await act(async () => {
      fireEvent.click(within(card).getByTestId("evolve-save"));
    });
    await waitFor(() => expect(onSave).toHaveBeenCalledTimes(1));
    const [strategy, proposal] = onSave.mock.calls[0] as unknown as [StrategyEntry, StoredProposal];
    expect(strategy.id).toBe("s");
    expect(proposal.id).toBe(id);
    expect(onChallenger).not.toHaveBeenCalled();
    await waitFor(() => expect(evolveNow().proposals.find((p) => p.id === id)!.decision).toBe("saved"));
    const stored = evolveNow().proposals.find((p) => p.id === id)!;
    expect(stored.savedAs).toBe("Version 3 von „Test“");
    // die anderen Vorschläge sind unberührt
    expect(evolveNow().proposals.filter((p) => p.id !== id).every((p) => p.decision === "open")).toBe(true);
    // gelernt: jede Art des Vorschlags angenommen, Zähler stimmen
    const s = evolveNow();
    expect(s.stats.accepted).toBe(1);
    for (const k of new Set(stored.kinds)) expect(s.learn[k]!.acc).toBe(1);
    // und die Karte wandert unter „Entschieden“ und sagt, was passiert ist
    fireEvent.click((await screen.findByText(/Entschieden \(1\)/)).parentElement!.querySelector("button")!);
    const decided = await screen.findByTestId("evolve-decided");
    expect(decided).toHaveTextContent("Gespeichert: Version 3 von „Test“");
  });

  it("scheitert der Host, bleibt der Vorschlag offen und der Grund steht da", async () => {
    await seedEvolve(props);
    const onSave = vi.fn(() => ({ ok: false as const, reason: "Die Regeln dieses Entwurfs haben sich seit dem Vorschlag geändert." }));
    renderPanel({ strategies: [rules()], candles: {}, onSaveVersion: onSave });
    const card = (await screen.findAllByTestId("evolve-proposal"))[0]!;
    await act(async () => {
      fireEvent.click(within(card).getByTestId("evolve-save"));
    });
    expect(await within(card).findByRole("alert")).toHaveTextContent(/seit dem Vorschlag geändert/);
    expect(evolveNow().proposals.every((p) => p.decision === "open")).toBe(true);
    expect(evolveNow().stats.accepted).toBe(0);
  });

  it("„Als Herausforderer live testen“: Konto-ID wird festgehalten, Entscheidung „challenger“, angenommen gezählt", async () => {
    await seedEvolve(props);
    const { onChallenger, onSave } = renderPanel({ strategies: [rules()], candles: {} });
    const card = (await screen.findAllByTestId("evolve-proposal"))[0]!;
    const id = card.getAttribute("data-id")!;
    await act(async () => {
      fireEvent.click(within(card).getByTestId("evolve-challenger"));
    });
    await waitFor(() => expect(onChallenger).toHaveBeenCalledTimes(1));
    expect(onSave).not.toHaveBeenCalled();
    await waitFor(() => expect(evolveNow().proposals.find((p) => p.id === id)!.decision).toBe("challenger"));
    expect(evolveNow().proposals.find((p) => p.id === id)!.challengerId).toBe("f_test1");
    expect(evolveNow().stats.accepted).toBe(1);
  });

  it("Ablehnen mit Begründung: erst nach der Bestätigung; abgelehnt gezählt, Grund gespeichert, Host nie gerufen", async () => {
    await seedEvolve(props);
    const { onSave, onChallenger } = renderPanel({ strategies: [rules()], candles: {} });
    const card = (await screen.findAllByTestId("evolve-proposal"))[2] ?? (await screen.findAllByTestId("evolve-proposal"))[0]!;
    const id = card.getAttribute("data-id")!;
    fireEvent.click(within(card).getByTestId("evolve-reject"));
    // noch nichts entschieden
    expect(evolveNow().proposals.find((p) => p.id === id)!.decision).toBe("open");
    fireEvent.change(within(card).getByTestId("evolve-reject-reason"), { target: { value: "Zu viele Änderungen auf einmal" } });
    await act(async () => {
      fireEvent.click(within(card).getByTestId("evolve-reject-confirm"));
    });
    await waitFor(() => expect(evolveNow().proposals.find((p) => p.id === id)!.decision).toBe("rejected"));
    const p = evolveNow().proposals.find((x) => x.id === id)!;
    expect(p.reason).toBe("Zu viele Änderungen auf einmal");
    expect(evolveNow().stats.rejected).toBe(1);
    expect(evolveNow().stats.accepted).toBe(0);
    for (const k of new Set(p.kinds)) expect(evolveNow().learn[k]!.rej).toBe(1);
    expect(onSave).not.toHaveBeenCalled();
    expect(onChallenger).not.toHaveBeenCalled();
    // die Lernkarte zeigt es – ehrlich: unter 5 Entscheidungen keine Quote
    const learned = screen.getByTestId("evolve-learned");
    await waitFor(() => expect(learned).toHaveAttribute("data-empty", "no"));
    expect(within(learned).getByTestId("evolve-learned-accept")).toHaveTextContent("1 Entscheidung – zu wenig für eine Quote");
  });

  it("Live-Prüfung eines Herausforderers: vor 21 Tagen und 10 Trades „zu früh“; nichts wird ins Lernen übernommen", async () => {
    const challenged = { ...props[0]!, decision: "challenger" as const, decidedAt: 5_000, challengerId: "f_live1" };
    await seedEvolve([challenged, ...props.slice(1)]);
    const acct = { ...newAccount({ id: "f_live1", name: "Herausforderer", config: challenged.config, signal: DEFAULT_SIGNAL_CFG, symbol: "TESTUSDT", capital: 10_000, riskPct: 1, maxLeverage: 5, exchange: "binance", slippage: { kind: "none" }, funding: "none", source: { kind: "editor", label: "x" } }, 1_700_000_000_000), cursor: { ...emptyCursor(), t: 1_700_000_000 + 5 * 86_400 } };
    const { settings, saveSettings } = useJournal.getState();
    await saveSettings({ ...settings, forward: withAccounts(settings.forward, [acct]) });
    renderPanel({ strategies: [rules()], candles: {} });
    fireEvent.click(await screen.findByText(/Entschieden \(1\)/).then((el) => el.parentElement!.querySelector("button")!));
    const live = await screen.findByTestId("evolve-live");
    expect(live).toHaveAttribute("data-level", "early");
    expect(live).toHaveTextContent("Noch zu früh für ein Urteil");
    expect(live).toHaveTextContent(/Erwartet \(aus den Testfenstern\)/);
    expect(live).toHaveTextContent(/Tatsächlich im Vorwärtstest/);
    expect(evolveNow().stats.confirmed + evolveNow().stats.below).toBe(0);
    expect(evolveNow().proposals.find((p) => p.id === challenged.id)!.outcome).toBeUndefined();
  });

  it("Konto des Herausforderers gelöscht: kein erfundenes Urteil", async () => {
    const challenged = { ...props[0]!, decision: "challenger" as const, decidedAt: 5_000, challengerId: "f_gone" };
    await seedEvolve([challenged]);
    renderPanel({ strategies: [rules()], candles: {} });
    fireEvent.click(await screen.findByText(/Entschieden \(1\)/).then((el) => el.parentElement!.querySelector("button")!));
    expect(await screen.findByText(/ohne Konto gibt es kein Urteil/)).toBeInTheDocument();
  });
});

describe("Optimierer · Was habe ich gelernt?", { timeout: 60_000 }, () => {
  it("leer: sagt es; mit genug Daten: Quoten mit Bereich, Änderungsarten mit Gewicht", async () => {
    renderPanel();
    expect(screen.getByTestId("evolve-learned-empty")).toBeInTheDocument();
    const { settings, saveSettings } = useJournal.getState();
    await saveSettings({
      ...settings,
      evolve: withEvolve(settings.evolve, {
        stats: { proposed: 14, accepted: 6, rejected: 4, confirmed: 3, below: 2, devSum: -7.5, devN: 5 },
        learn: { addTrend: { acc: 3, rej: 0, good: 2, bad: 1 }, trail: { acc: 3, rej: 4, good: 1, bad: 1 } },
      }),
    });
    const learned = screen.getByTestId("evolve-learned");
    await waitFor(() => expect(learned).toHaveAttribute("data-empty", "no"));
    expect(within(learned).getByTestId("evolve-learned-accept")).toHaveTextContent(/6 von 10 Vorschlägen \(60 %, 80-%-Bereich \d+–\d+ %\)/);
    expect(within(learned).getByTestId("evolve-learned-hit")).toHaveTextContent(/3 von 5 live getesteten Vorschlägen haben sich bestätigt \(60 %/);
    expect(within(learned).getByTestId("evolve-learned-match")).toHaveTextContent(/im Schnitt 1,5 Prozentpunkte pro 30 Tage unter der Vorhersage/);
    const kinds = within(learned).getAllByTestId("evolve-learned-kind");
    expect(kinds.map((k) => k.getAttribute("data-kind"))).toEqual(["trail", "addTrend"]);
    expect(kinds[1]).toHaveTextContent("Trend-Filter");
    expect(kinds[1]).toHaveTextContent(/von 3 Entscheidungen hast du 3 angenommen \(100 %\)/);
  });
});

describe("Optimierer · Versuchsprotokoll", { timeout: 90_000 }, () => {
  it("die Schublade zeigt jede getestete Variante mit Score, Seed und Satz; der Zähler schrumpft nie", async () => {
    renderPanel({ budget: 20 });
    fireEvent.click(screen.getByTestId("evolve-start"));
    await waitFor(() => expect(screen.getByTestId("evolve-panel")).toHaveAttribute("data-status", "done"), { timeout: 60_000 });
    fireEvent.click(screen.getByTestId("evolve-protocol-open"));
    const sheet = await screen.findByTestId("evolve-protocol", {}, { timeout: 15_000 });
    expect(sheet).toHaveTextContent(/Varianten getestet/);
    const rows = within(sheet).getAllByTestId("evolve-protocol-row");
    expect(rows.length).toBeGreaterThanOrEqual(21);
    expect(rows.some((r) => r.getAttribute("data-via") === "baseline")).toBe(true);
    expect(sheet).toHaveTextContent(/Seed \d+/);
    expect(sheet).toHaveTextContent(/Gleiche Daten, gleiche Regeln und gleicher Seed ergeben dieselbe Reihenfolge/);
    // die Zusammenfassung steht auch lokal (Gerät), nicht in den Einstellungen
    expect(localStorage.getItem("tj2-evolve-log") ?? "").toContain('"logs"');
  });
});

describe("Test-Daten", () => {
  it("die synthetischen Pfade haben echte Kerzen (Hoch/Tief außerhalb von Eröffnung/Schluss)", () => {
    const bars = path(200, 5, 0);
    expect(bars.filter((b) => b.h > Math.max(b.o, b.c) * 1.0001).length).toBeGreaterThan(100);
  });
});
