/**
 * F62 "Chart spiegeln / Bias prüfen" (`src/views/biasTest`) on the real journal store: the switch and the layer chips,
 * the guided test in its order (first answer STORED before the chart turns, second STORED before the original returns),
 * the blind state, the plain comparison, the history with a later outcome, an unfinished test and a failed write.
 */
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { BiasContext } from "@/domain/biasTest";
import { biasTestsOf } from "@/domain/biasTest";
import { MotionRoot } from "@/motion/MotionRoot";
import { useJournal } from "@/store/journalStore";
import { MirrorPanel, useBiasUi, useMirrorState } from "@/views/biasTest";
import { DEFAULT_LAYERS } from "@/views/biasTest/flowStore";
import { bootFixtureJournal, installDomPolyfills } from "./views.overview.harness";

const ANCHOR = Date.parse("2026-10-12T08:00:00Z");
const CTX: BiasContext = { surface: "markt", symbol: "BTCUSDT", interval: "4h", anchorMs: ANCHOR };

/** What a surface reads, made visible. */
function Probe() {
  const s = useMirrorState("markt");
  return (
    <output data-testid="probe" data-flipped={s.view.flipped} data-frozen={s.frozen} data-anchor={s.anchorMs ?? ""} data-phase={s.phase ?? ""} data-hide-name={s.blind.hideName} data-neutral={s.chart.neutral} data-rsi={s.view.layers.rsi} data-boxes={s.view.layers.boxes} />
  );
}

function mount(opts: { capture?: () => BiasContext | { reason: string }; canResume?: () => boolean } = {}) {
  return render(
    <MotionRoot>
      <Probe />
      <MirrorPanel surface="markt" capture={opts.capture ?? (() => CTX)} canResume={opts.canResume} />
    </MotionRoot>,
  );
}
const probe = () => screen.getByTestId("probe");
const stored = () => biasTestsOf(useJournal.getState().settings);

async function fillAndSubmit(first: boolean, direction: "Long" | "Short" | "Neutral", conditions: string, invalidation: string) {
  const form = await screen.findByTestId(first ? "bias-first" : "bias-second");
  fireEvent.click(within(form).getByRole("radio", { name: direction }));
  fireEvent.change(within(form).getByTestId("bias-conditions"), { target: { value: conditions } });
  fireEvent.change(within(form).getByTestId("bias-invalidation"), { target: { value: invalidation } });
  await act(async () => {
    fireEvent.click(screen.getByTestId(first ? "bias-submit-first" : "bias-submit-second"));
  });
}

describe("Chart spiegeln / Bias prüfen", () => {
  beforeAll(() => {
    installDomPolyfills();
    HTMLCanvasElement.prototype.getContext = (() => null) as unknown as typeof HTMLCanvasElement.prototype.getContext;
  });
  beforeEach(async () => {
    localStorage.clear();
    await bootFixtureJournal();
    useBiasUi.setState({ flipped: { markt: false, replay: false }, prefs: { markt: { layers: { ...DEFAULT_LAYERS.markt }, rsiMirrored: false }, replay: { layers: { ...DEFAULT_LAYERS.replay }, rsiMirrored: false } }, flow: null });
  });

  it("der freie Schalter spiegelt, zweimal ist wieder das Original; die Ebenen sind einzeln schaltbar; der RSI wird nie still mitgespiegelt", async () => {
    mount();
    expect(probe()).toHaveAttribute("data-flipped", "false");
    expect(screen.queryByTestId("bias-rsi-option")).toBeNull();
    fireEvent.click(screen.getByTestId("bias-flip"));
    expect(probe()).toHaveAttribute("data-flipped", "true");
    expect(screen.getByTestId("bias-flip-note")).toHaveTextContent("Kurse und Zeiten sind unverändert");
    // the RSI option exists, is OFF by default and says what it does
    const rsi = screen.getByTestId("bias-rsi-mirror") as HTMLInputElement;
    expect(rsi.checked).toBe(false);
    expect(screen.getByTestId("bias-rsi-option")).toHaveTextContent("100−RSI");
    fireEvent.click(screen.getByTestId("bias-flip"));
    expect(probe()).toHaveAttribute("data-flipped", "false");
    // layers
    const boxes = screen.getByRole("button", { name: "Boxen" });
    expect(boxes).toHaveAttribute("aria-pressed", "true");
    fireEvent.click(boxes);
    expect(probe()).toHaveAttribute("data-boxes", "false");
    fireEvent.click(screen.getByRole("button", { name: "RSI" }));
    expect(probe()).toHaveAttribute("data-rsi", "false");
    // own trades start off on the Markt chart (it shows none today)
    expect(screen.getByRole("button", { name: "Eigene Trades" })).toHaveAttribute("aria-pressed", "false");
  });

  it("Testablauf: erste Antwort wird GESPEICHERT, bevor gespiegelt wird; zweite, bevor das Original zurückkommt; dann der Vergleich", async () => {
    mount();
    fireEvent.click(screen.getByTestId("bias-start"));
    expect(await screen.findByTestId("bias-setup")).toBeInTheDocument();
    fireEvent.click(screen.getByLabelText("Marktnamen verdecken"));
    fireEvent.click(screen.getByLabelText("Long-/Short-Farben neutralisieren"));
    fireEvent.click(screen.getByTestId("bias-begin"));

    // step 1: frozen at the anchor, original orientation, name covered, colours neutral, nothing stored yet
    await screen.findByTestId("bias-first");
    expect(probe()).toHaveAttribute("data-phase", "first");
    expect(probe()).toHaveAttribute("data-flipped", "false");
    expect(probe()).toHaveAttribute("data-frozen", "true");
    expect(probe()).toHaveAttribute("data-anchor", String(ANCHOR));
    expect(probe()).toHaveAttribute("data-hide-name", "true");
    expect(probe()).toHaveAttribute("data-neutral", "true");
    expect(stored()).toHaveLength(0);
    expect((screen.getByTestId("bias-flip") as HTMLButtonElement).disabled).toBe(true);

    // an incomplete answer is not stored and says what is missing
    await act(async () => {
      fireEvent.click(screen.getByTestId("bias-submit-first"));
    });
    expect(screen.getByTestId("bias-gaps")).toHaveTextContent("Richtung wählen");
    expect(stored()).toHaveLength(0);

    const T1 = Date.now();
    await fillAndSubmit(true, "Long", "Schluss über 86.000", "unter 84.500");
    // → the first answer is in the journal (with its timestamp) BEFORE the chart is turned … and now it is
    expect(stored()).toHaveLength(1);
    const t = stored()[0]!;
    expect(t.first).toMatchObject({ direction: "long", conditions: "Schluss über 86.000", invalidation: "unter 84.500" });
    expect(Date.parse(t.first.at)).toBeGreaterThanOrEqual(T1 - 5);
    expect(t.second).toBeUndefined();
    expect(t.context).toMatchObject({ symbol: "BTCUSDT", interval: "4h", anchorMs: ANCHOR });
    expect(t.blind).toMatchObject({ hideName: true, neutralColors: true });
    await screen.findByTestId("bias-second");
    expect(probe()).toHaveAttribute("data-phase", "flipped");
    expect(probe()).toHaveAttribute("data-flipped", "true");
    expect(probe()).toHaveAttribute("data-frozen", "true");

    // step 2: the second answer is stored, THEN the original comes back and the name is uncovered
    await fillAndSubmit(false, "Long", "Ausbruch nach oben", "unter dem Tief");
    const done = stored()[0]!;
    expect(done.second).toMatchObject({ direction: "long" });
    expect(done.revealedAt).toBeTruthy();
    expect(done.first).toEqual(t.first);
    const revealed = await screen.findByTestId("bias-revealed");
    expect(probe()).toHaveAttribute("data-phase", "revealed");
    expect(probe()).toHaveAttribute("data-flipped", "false");
    expect(probe()).toHaveAttribute("data-frozen", "false");
    expect(probe()).toHaveAttribute("data-hide-name", "false");
    expect(probe()).toHaveAttribute("data-neutral", "false");
    // both answers side by side, the contradiction plainly – no score
    const cmp = within(revealed).getByTestId("bias-comparison");
    expect(cmp).toHaveAttribute("data-relation", "same");
    expect(within(cmp).getByTestId("bias-headline")).toHaveTextContent("Widerspruch");
    expect(cmp).toHaveTextContent("Schluss über 86.000");
    expect(cmp).toHaveTextContent("Ausbruch nach oben");
    expect(revealed.textContent).not.toMatch(/Score|voreingenommen/i);
    fireEvent.click(screen.getByTestId("bias-done"));
    await waitFor(() => expect(screen.queryByTestId("bias-panel")).toBeNull());
    expect(probe()).toHaveAttribute("data-phase", "");
  });

  it("Verlauf: beide Antworten, das später eingetragene Ergebnis; ohne Stichprobe keine Muster-Aussage", async () => {
    mount();
    fireEvent.click(screen.getByTestId("bias-start"));
    fireEvent.click(await screen.findByTestId("bias-begin"));
    await fillAndSubmit(true, "Short", "Bruch der Box", "über 86.500");
    await fillAndSubmit(false, "Long", "Bruch der gespiegelten Box", "unter 85.000");
    fireEvent.click(await screen.findByTestId("bias-done"));
    fireEvent.click(screen.getByTestId("bias-history-toggle"));
    const history = await screen.findByTestId("bias-history");
    expect(within(history).getByTestId("bias-summary")).toHaveTextContent("zu wenig, um ein Muster zu erkennen");
    const row = within(history).getByTestId("bias-history-row");
    expect(row).toHaveTextContent("1. Antwort: Short");
    expect(row).toHaveTextContent("2. Antwort: Long");
    expect(row).toHaveTextContent("Ergebnis noch nicht eingetragen");
    fireEvent.click(within(row).getByRole("button", { name: "Details" }));
    expect(within(row).getByTestId("bias-comparison")).toHaveAttribute("data-relation", "mirrored");
    fireEvent.click(within(row).getByRole("radio", { name: "Preis fiel" }));
    fireEvent.change(within(row).getByLabelText("Notiz (optional)"), { target: { value: "fiel am nächsten Tag" } });
    await act(async () => {
      fireEvent.click(within(row).getByRole("button", { name: "Ergebnis eintragen" }));
    });
    expect(stored()[0]!.outcome).toMatchObject({ value: "down", note: "fiel am nächsten Tag" });
    await waitFor(() => expect(within(history).getByTestId("bias-history-row")).toHaveTextContent("Preis fiel"));
  });

  it("ein nicht abgeschlossener Test bleibt gespeichert, verdeckt den Marktnamen und lässt sich fortsetzen oder verwerfen", async () => {
    mount();
    fireEvent.click(screen.getByTestId("bias-start"));
    fireEvent.click(await screen.findByLabelText("Marktnamen verdecken"));
    fireEvent.click(screen.getByTestId("bias-begin"));
    await fillAndSubmit(true, "Neutral", "keine klare Struktur", "");
    expect(stored()).toHaveLength(1);
    // leaving the page drops the live state but not the stored first answer
    cleanup();
    expect(useBiasUi.getState().flow).toBeNull();
    expect(stored()).toHaveLength(1);

    mount({ canResume: () => false });
    fireEvent.click(screen.getByTestId("bias-history-toggle"));
    const row = await screen.findByTestId("bias-history-row");
    expect(row).toHaveAttribute("data-open", "true");
    expect(row).toHaveTextContent("Markt verdeckt");
    expect(row).not.toHaveTextContent("BTCUSDT");
    expect(within(row).getByTestId("bias-resume")).toBeDisabled();
    cleanup();

    mount({ canResume: () => true });
    fireEvent.click(screen.getByTestId("bias-history-toggle"));
    fireEvent.click(await screen.findByTestId("bias-resume"));
    await screen.findByTestId("bias-second");
    expect(probe()).toHaveAttribute("data-flipped", "true");
    expect(probe()).toHaveAttribute("data-hide-name", "true");
    // cancelling leaves the stored first answer; discarding removes an unfinished test
    fireEvent.click(screen.getByRole("button", { name: "Abbrechen" }));
    fireEvent.click(await screen.findByRole("button", { name: "Verwerfen" }));
    await waitFor(() => expect(stored()).toHaveLength(0));
  });

  it("scheitert das Speichern, bleibt der Test auf Schritt 1 (kein Spiegeln ohne gespeicherte Antwort)", async () => {
    mount();
    fireEvent.click(screen.getByTestId("bias-start"));
    fireEvent.click(await screen.findByTestId("bias-begin"));
    const real = useJournal.getState().saveSettings;
    useJournal.setState({ saveSettings: vi.fn().mockRejectedValueOnce(new Error("quota")) as never });
    await fillAndSubmit(true, "Long", "x", "y");
    useJournal.setState({ saveSettings: real });
    expect(stored()).toHaveLength(0);
    expect(probe()).toHaveAttribute("data-phase", "first");
    expect(probe()).toHaveAttribute("data-flipped", "false");
  });

  it("ohne geschlossene Kerze startet der Test nicht und sagt warum", async () => {
    mount({ capture: () => ({ reason: "Noch keine geschlossene Kerze geladen." }) });
    fireEvent.click(screen.getByTestId("bias-start"));
    fireEvent.click(await screen.findByTestId("bias-begin"));
    expect(await screen.findByTestId("bias-reason")).toHaveTextContent("Noch keine geschlossene Kerze");
    expect(probe()).toHaveAttribute("data-phase", "setup");
  });
});
