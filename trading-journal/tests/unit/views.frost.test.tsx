/**
 * Paket F2 in the views: the journal card (index "n von m" from the real list, paging by button / key / swipe, empty state), the
 * question bar (dot → bar → shimmer → three cards, unknown question, reduced motion, the trades behind an answer) and the closing
 * ritual (the confirmation only after PROCESS – never after a profit, a loss or a number of trades; vibration / tone off by default).
 * Numbers come from the hand-worked journal of `ask.fixtures.ts`.
 */
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { dayClosesOf } from "@/domain/coach";
import { MorphDialogProvider } from "@/motion/MorphDialog";
import { MotionRoot } from "@/motion/MotionRoot";
import * as feedback from "@/motion/processFeedback";
import { useJournal } from "@/store/journalStore";
import { useUi } from "@/store/uiStore";
import { AskJournalCard, ASK_COPY, SEEK_MS } from "@/views/berichte/AskJournalCard";
import { BerichteView, useBerichteUi } from "@/views/berichte";
import { JournalCard, JOURNAL_STRINGS } from "@/views/berichte/JournalCard";
import { ASK_SETTINGS, askTrades, askWorld } from "./ask.fixtures";
import { mkTrade } from "./domain.fixtures";
import { bootFixtureJournal, installDomPolyfills } from "./views.overview.harness";

/** `useReducedFx` is cached by the motion library after its first read – the tests switch it here instead of through matchMedia. */
const fx = vi.hoisted(() => ({ reduced: true }));
vi.mock("@/motion/useReducedFx", () => ({ useReducedFx: () => fx.reduced }));

function matchMediaReduced(reduced: boolean) {
  fx.reduced = reduced;
  window.matchMedia = ((q: string) => ({ matches: reduced && q.includes("reduced-motion"), media: q, onchange: null, addListener() {}, removeListener() {}, addEventListener() {}, removeEventListener() {}, dispatchEvent: () => false })) as unknown as typeof window.matchMedia;
}

const world = askWorld();
const closed = world.data.closed;

beforeAll(() => {
  installDomPolyfills();
  HTMLCanvasElement.prototype.getContext = (() => null) as unknown as typeof HTMLCanvasElement.prototype.getContext;
});
afterEach(() => {
  vi.useRealTimers();
  useUi.setState({ acc: "all", toasts: [], detail: { id: null, source: null } });
});

/* ------------------------------------------------------------------------------------------ Journal-Karte */

describe("Einträge durchgehen: die Journal-Karte", () => {
  beforeEach(() => matchMediaReduced(true));
  const renderCard = (trades = closed) =>
    render(
      <MotionRoot>
        <JournalCard trades={trades} settings={ASK_SETTINGS} />
      </MotionRoot>,
    );
  const pill = () => screen.getByTestId("journal-pill").textContent;

  it("opens on the first entry of the REAL list: „Eintrag 01 von 12“, the outline numeral, real setup chips, the R in the loss tone", () => {
    renderCard();
    expect(pill()).toBe("Eintrag 01 von 12");
    expect(screen.getByTestId("journal-cards")).toHaveAttribute("data-total", "12");
    expect(screen.getByTestId("journal-entry")).toHaveAttribute("data-id", "T0");
    expect(screen.getByRole("heading", { level: 3 })).toHaveTextContent("BTC/USDT");
    expect(screen.getAllByTestId("journal-chip").map((c) => c.textContent)).toEqual(["Breakout"]);
    // T0: −500 at 200 risk = −2,5 R; a loss is red and plainly signed
    const r = screen.getByTestId("journal-r");
    expect(r).toHaveTextContent("−2,50 R");
    expect(r).toHaveAttribute("data-tone", "loss");
    expect(r.className).toContain("text-loss");
    expect(screen.getByTestId("journal-net")).toHaveTextContent("−500,00 netto");
    expect(screen.getByTestId("journal-review")).toHaveTextContent("Review offen");
    // the giant word is decoration only
    const word = screen.getByTestId("journal-word");
    expect(word).toHaveAttribute("aria-hidden", "true");
    expect(word.textContent).toBe("");
    expect(word.getAttribute("data-word")).toBe("REVIEW");
  });

  it("pages with the buttons, stops at both ends (disabled, no wrap) and keeps „n von m“ in step with the entry", () => {
    renderCard();
    const prev = screen.getByTestId("journal-prev");
    const next = screen.getByTestId("journal-next");
    expect(prev).toBeDisabled();
    fireEvent.click(next);
    expect(pill()).toBe("Eintrag 02 von 12");
    expect(screen.getByTestId("journal-entry")).toHaveAttribute("data-id", "T1");
    // T1: +200 = +2 R in the win tone, two checklist items ticked, a review
    expect(screen.getByTestId("journal-r")).toHaveTextContent("+2,00 R");
    expect(screen.getByTestId("journal-r")).toHaveAttribute("data-tone", "win");
    expect(screen.getByTestId("journal-review")).toHaveTextContent("Review geschrieben");
    expect(screen.getByText("Checkliste 2 von 2")).toBeInTheDocument();
    fireEvent.click(prev);
    expect(pill()).toBe("Eintrag 01 von 12");
    for (let i = 0; i < 20; i++) if (!(next as HTMLButtonElement).disabled) fireEvent.click(next);
    expect(pill()).toBe("Eintrag 12 von 12");
    expect(next).toBeDisabled();
    expect(screen.getByTestId("journal-entry")).toHaveAttribute("data-id", "T11");
  });

  it("pages with the keyboard (← → Home End) when the card has focus; other keys do nothing", () => {
    renderCard();
    const card = screen.getByTestId("journal-card");
    card.focus();
    fireEvent.keyDown(card, { key: "ArrowRight" });
    fireEvent.keyDown(card, { key: "ArrowRight" });
    expect(pill()).toBe("Eintrag 03 von 12");
    fireEvent.keyDown(card, { key: "End" });
    expect(pill()).toBe("Eintrag 12 von 12");
    fireEvent.keyDown(card, { key: "ArrowRight" });
    expect(pill()).toBe("Eintrag 12 von 12");
    fireEvent.keyDown(card, { key: "ArrowLeft" });
    expect(pill()).toBe("Eintrag 11 von 12");
    fireEvent.keyDown(card, { key: "Home" });
    expect(pill()).toBe("Eintrag 01 von 12");
    fireEvent.keyDown(card, { key: "x" });
    fireEvent.keyDown(card, { key: "Enter" });
    expect(pill()).toBe("Eintrag 01 von 12");
  });

  it("pages by swipe: left = next, right = previous; a tap or a scroll does not turn", () => {
    renderCard();
    const card = screen.getByTestId("journal-card");
    const swipe = (dx: number, dy = 0) => {
      fireEvent.pointerDown(card, { clientX: 200, clientY: 100, pointerType: "touch", button: 0 });
      fireEvent.pointerUp(card, { clientX: 200 + dx, clientY: 100 + dy, pointerType: "touch", button: 0 });
    };
    swipe(-90);
    expect(pill()).toBe("Eintrag 02 von 12");
    swipe(-90, 4);
    expect(pill()).toBe("Eintrag 03 von 12");
    swipe(100);
    expect(pill()).toBe("Eintrag 02 von 12");
    swipe(-5);
    swipe(-60, 120);
    expect(pill()).toBe("Eintrag 02 von 12");
  });

  it("announces a step to screen readers (not the first paint) and the card is named", () => {
    renderCard();
    const live = screen.getByTestId("journal-live");
    expect(live).toHaveTextContent("");
    expect(screen.getByTestId("journal-card")).toHaveAttribute("aria-label", "Eintrag 1 von 12");
    fireEvent.click(screen.getByTestId("journal-next"));
    expect(live).toHaveTextContent("Eintrag 2 von 12: BTC/USDT, Long, +2,00 R");
    // an entry without a stop is announced as such, not with an invented R
    for (let i = 0; i < 6; i++) fireEvent.click(screen.getByTestId("journal-next"));
    expect(screen.getByTestId("journal-entry")).toHaveAttribute("data-id", "T7");
    expect(live).toHaveTextContent("Eintrag 8 von 12: BTC/USDT, Long, kein Stopp, daher kein R");
    expect(screen.getByTestId("journal-r")).toHaveTextContent("– R");
    expect(screen.getByTestId("journal-net")).toHaveTextContent("kein Stopp, daher kein R");
  });

  it("„Trade öffnen“ opens the trade detail of exactly this entry", () => {
    renderCard();
    fireEvent.click(screen.getByTestId("journal-next"));
    fireEvent.click(screen.getByTestId("journal-open"));
    expect(useUi.getState().detail.id).toBe("T1");
  });

  it("an empty period says so honestly – no card, no word, no invented entry", () => {
    renderCard([]);
    const card = screen.getByTestId("journal-cards");
    expect(card).toHaveAttribute("data-state", "empty");
    expect(card).toHaveTextContent(JOURNAL_STRINGS.empty);
    expect(screen.queryByTestId("journal-card")).toBeNull();
    expect(screen.queryByTestId("journal-word")).toBeNull();
  });

  it("never hides a loss: no celebration wording, the same markup for every entry", () => {
    renderCard();
    const seen = new Set<string>();
    for (let i = 0; i < 12; i++) {
      seen.add(screen.getByTestId("journal-r").tagName);
      expect(screen.getByTestId("journal-card").textContent).not.toMatch(/Gewinner|Glückwunsch|Konfetti|knapp|fast gewonnen|Rekord|Serie/i);
      if (i < 11) fireEvent.click(screen.getByTestId("journal-next"));
    }
    expect([...seen]).toEqual(["OUTPUT"]);
  });

  it("the touch targets are at least 44 px (the stylesheet says so, the e2e measures it)", () => {
    const css = readFileSync(join(__dirname, "../../src/views/berichte/frost.css"), "utf8");
    const rule = (sel: string) => new RegExp(`${sel.replace(".", "\\.")}\\s*\\{([^}]*)\\}`).exec(css)?.[1] ?? "";
    for (const sel of [".fr-round", ".fr-dotbtn"]) {
      const body = rule(sel);
      expect(body, sel).toMatch(/width:\s*2\.75rem/);
      expect(body, sel).toMatch(/height:\s*2\.75rem/);
    }
    expect(rule(".fr-check")).toMatch(/width:\s*4rem/);
    for (const sel of [".fr-chip", ".fr-send", ".fr-open"]) expect(rule(sel), sel).toMatch(/min-height:\s*2\.75rem/);
  });
});

/* ------------------------------------------------------------------------------------- Frag dein Journal */

describe("Frag dein Journal: die Suchleiste", () => {
  const page = { view: { closed, list: world.enriched, start: world.data.start }, settings: ASK_SETTINGS, events: world.data.events, cur: "USDT" } as unknown as Parameters<typeof AskJournalCard>[0]["page"];
  const renderAsk = () =>
    render(
      <MotionRoot>
        <AskJournalCard page={page} />
      </MotionRoot>,
    );
  const type = (q: string) => {
    fireEvent.click(screen.getByTestId("ask-open"));
    fireEvent.change(screen.getByTestId("ask-input"), { target: { value: q } });
    fireEvent.click(screen.getByTestId("ask-send"));
  };

  describe("with motion", () => {
    beforeEach(() => {
      matchMediaReduced(false);
      vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "Date"] });
      vi.setSystemTime(new Date(2026, 5, 10, 12));
    });

    it("starts as a dot with three example questions; opening grows the bar and focuses the input", () => {
      renderAsk();
      const bar = screen.getByTestId("ask-bar");
      expect(bar).not.toHaveAttribute("data-open");
      expect(screen.getByTestId("ask-input")).toHaveAttribute("tabindex", "-1");
      expect(screen.getAllByTestId("ask-example").map((b) => b.textContent)).toEqual(["Verluste im Setup Breakout letzten Monat", "Trades ohne Stopp", "Beste Wochentage"]);
      fireEvent.click(screen.getByTestId("ask-open"));
      expect(bar).toHaveAttribute("data-open");
      expect(screen.getByTestId("ask-input")).toHaveAttribute("tabindex", "0");
    });

    it("typing a question shows the shimmer with the REAL trade count, then three cards with the hand-worked numbers", async () => {
      renderAsk();
      type("Trades ohne Stopp");
      expect(screen.getByTestId("ask-journal")).toHaveAttribute("data-phase", "seek");
      expect(screen.getByTestId("ask-seek")).toHaveTextContent("Durchsuche 12 Trades …");
      expect(screen.queryByTestId("ask-cards")).toBeNull();
      await act(async () => {
        vi.advanceTimersByTime(SEEK_MS + 5);
      });
      expect(screen.getByTestId("ask-journal")).toHaveAttribute("data-phase", "done");
      expect(screen.getByTestId("ask-seek")).toHaveTextContent("");
      const cards = screen.getAllByTestId("ask-card");
      expect(cards).toHaveLength(3);
      expect(screen.getAllByTestId("ask-card-value").map((v) => v.textContent)).toEqual(["2 von 12 (17 %)", "−250 USDT", "ohne −125 USDT · mit −11 USDT"]);
      expect(screen.getByTestId("ask-text")).toHaveTextContent("2 von 12");
      expect(screen.getByTestId("ask-confidence")).toHaveTextContent("Belastbarkeit");
      expect(within(screen.getByTestId("ask-answer")).getByLabelText(ASK_COPY.reading)).toHaveTextContent("Trades ohne Stopp");
    });

    it("each card fans out with its own order (the CSS custom property --i) from the middle", async () => {
      renderAsk();
      type("Beste Wochentage");
      await act(async () => {
        vi.advanceTimersByTime(SEEK_MS + 5);
      });
      const cards = screen.getAllByTestId("ask-card");
      expect(cards.map((c) => c.style.getPropertyValue("--i"))).toEqual(["0", "1", "2"]);
      expect(cards.map((c) => within(c).getByTestId("ask-card-value").textContent)).toEqual(["+100 USDT", "−80 USDT", "−430 USDT"]);
    });

    it("the trades behind an answer open as a list; each row opens the trade", async () => {
      renderAsk();
      type("Verluste im Setup Breakout letzten Monat");
      await act(async () => {
        vi.advanceTimersByTime(SEEK_MS + 5);
      });
      const toggle = screen.getByTestId("ask-trades-toggle");
      expect(toggle).toHaveTextContent("Betroffene Trades (4)");
      expect(toggle).toHaveAttribute("aria-expanded", "false");
      fireEvent.click(toggle);
      const list = screen.getByTestId("ask-trades");
      const rows = list.querySelectorAll<HTMLElement>("[data-trade-id]");
      expect([...rows].map((r) => r.dataset.tradeId)).toEqual(["T7", "T6", "T3", "T2"]);
      expect(list).toHaveTextContent("Alle 4");
      fireEvent.click(rows[0]!);
      expect(useUi.getState().detail.id).toBe("T7");
    });

    it("a question it cannot place: „So kann ich das noch nicht beantworten.“, three examples, no card, no number", async () => {
      renderAsk();
      type("Wie wird das Wetter morgen?");
      await act(async () => {
        vi.advanceTimersByTime(SEEK_MS + 5);
      });
      const box = screen.getByTestId("ask-unknown");
      expect(box).toHaveTextContent("So kann ich das noch nicht beantworten.");
      expect(box).toHaveTextContent("„wetter“");
      expect(within(box).getAllByTestId("ask-example")).toHaveLength(3);
      expect(screen.queryByTestId("ask-cards")).toBeNull();
      expect(screen.queryByTestId("ask-trades-block")).toBeNull();
      // an example is one click away – and answered
      fireEvent.click(within(box).getAllByTestId("ask-example")[1]!);
      await act(async () => {
        vi.advanceTimersByTime(SEEK_MS + 5);
      });
      expect(screen.getAllByTestId("ask-card")).toHaveLength(3);
    });

    it("a selection without trades is said plainly, not as zero", async () => {
      renderAsk();
      type("Verluste im Januar");
      await act(async () => {
        vi.advanceTimersByTime(SEEK_MS + 5);
      });
      expect(screen.getByTestId("ask-empty")).toHaveTextContent("keine abgeschlossenen Trades");
      expect(screen.queryByTestId("ask-cards")).toBeNull();
    });

    it("a new question replaces the old answer (never both); „Zurücksetzen“ returns to the examples", async () => {
      renderAsk();
      type("Trades ohne Review");
      await act(async () => {
        vi.advanceTimersByTime(SEEK_MS + 5);
      });
      expect(screen.getAllByTestId("ask-card-value")[0]).toHaveTextContent("7 von 12 (58 %)");
      fireEvent.change(screen.getByTestId("ask-input"), { target: { value: "Trades ohne Stopp" } });
      fireEvent.click(screen.getByTestId("ask-send"));
      expect(screen.queryByTestId("ask-cards")).toBeNull();
      await act(async () => {
        vi.advanceTimersByTime(SEEK_MS + 5);
      });
      expect(screen.getAllByTestId("ask-card")).toHaveLength(3);
      expect(screen.getAllByTestId("ask-card-value")[0]).toHaveTextContent("2 von 12 (17 %)");
      fireEvent.click(screen.getByTestId("ask-reset"));
      expect(screen.getByTestId("ask-journal")).toHaveAttribute("data-phase", "idle");
      expect(screen.getAllByTestId("ask-example")).toHaveLength(3);
    });

    it("submit is off for an empty question; the whole thing runs without a network call", async () => {
      const fetchSpy = vi.spyOn(globalThis, "fetch");
      renderAsk();
      fireEvent.click(screen.getByTestId("ask-open"));
      expect(screen.getByTestId("ask-send")).toBeDisabled();
      fireEvent.change(screen.getByTestId("ask-input"), { target: { value: "Beste Wochentage" } });
      fireEvent.submit(screen.getByTestId("ask-bar"));
      await act(async () => {
        vi.advanceTimersByTime(SEEK_MS + 5);
      });
      expect(screen.getAllByTestId("ask-card")).toHaveLength(3);
      expect(fetchSpy).not.toHaveBeenCalled();
      fetchSpy.mockRestore();
    });
  });

  describe("reduced motion", () => {
    beforeEach(() => matchMediaReduced(true));

    it("no shimmer beat: the answer stands there at once", () => {
      renderAsk();
      type("Beste Wochentage");
      expect(screen.getByTestId("ask-journal")).toHaveAttribute("data-phase", "done");
      expect(screen.getAllByTestId("ask-card")).toHaveLength(3);
      expect(screen.getByTestId("ask-seek")).toHaveTextContent("");
    });
  });
});

/* ------------------------------------------------------------------------------ Heute abschließen (Ritual) */

describe("Heute abschließen: das Abschluss-Ritual in Berichte", () => {
  const spies: { vibrate: ReturnType<typeof vi.spyOn>; tone: ReturnType<typeof vi.spyOn> } = {} as never;

  async function load(trades = askTrades(), days: Record<string, unknown> = {}) {
    await act(async () => {
      useJournal.setState({ trades, settings: { ...ASK_SETTINGS }, days: days as never });
    });
  }
  const renderView = () =>
    render(
      <MotionRoot>
        <MorphDialogProvider>
          <BerichteView />
        </MorphDialogProvider>
      </MotionRoot>,
    );
  const milestones = () => useUi.getState().toasts.filter((t) => t.milestone);

  beforeEach(async () => {
    matchMediaReduced(true);
    await bootFixtureJournal();
    useBerichteUi.getState().reset();
    // Wed 2026-06-10 12:00 – the running week is KW 24
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date(2026, 5, 10, 12));
    useBerichteUi.getState().setPeriod("2026-W24");
    spies.vibrate = vi.spyOn(feedback.channels, "vibrate").mockImplementation(() => undefined);
    spies.tone = vi.spyOn(feedback.channels, "tone").mockImplementation(() => undefined);
    feedback.useFeedbackPref.setState({ sound: false, haptic: false });
    useUi.setState({ toasts: [] });
  });
  afterEach(() => {
    spies.vibrate.mockRestore();
    spies.tone.mockRestore();
    feedback.useFeedbackPref.setState({ sound: false, haptic: false });
  });

  it("shows for the running week: today's three items from the real journal, the week as dots, both channels OFF", async () => {
    await load();
    renderView();
    const card = await screen.findByTestId("day-close");
    expect(card).toHaveAttribute("data-state", "open");
    // today (Wed 10.6.) has no trade: checklist and review do not apply, the note is open
    expect(screen.getByTestId("day-close-item-checklist")).toHaveAttribute("data-state", "na");
    expect(screen.getByTestId("day-close-item-review")).toHaveAttribute("data-state", "na");
    expect(screen.getByTestId("day-close-item-reflection")).toHaveAttribute("data-state", "open");
    // KW 24: Monday (T11, reviewed) is done, today is still open, the rest lies ahead – a sentence without a shortfall
    const dots = within(screen.getByTestId("day-close-days")).getAllByRole("listitem");
    expect(dots.map((d) => d.getAttribute("data-state"))).toEqual(["done", "rest", "today", "later", "later", "later", "later"]);
    expect(screen.getByTestId("day-close-days-text")).toHaveTextContent("1 Tag mit Rückblick bisher");
    expect(screen.getByTestId("day-close-haptic")).toHaveAttribute("aria-checked", "false");
    expect(screen.getByTestId("day-close-sound")).toHaveAttribute("aria-checked", "false");
    expect(card.textContent).not.toMatch(/verpass|Serie|Streak|in Gefahr|nur noch|Gewinn|Verlust|Netto|USDT/i);
  });

  it("closing a day with something open is recorded QUIETLY: an info toast, no confirmation, no vibration, no tone – even with both switched on", async () => {
    await load();
    feedback.useFeedbackPref.setState({ sound: true, haptic: true });
    renderView();
    fireEvent.click(await screen.findByTestId("day-close-done"));
    await waitFor(() => expect(screen.getByTestId("day-close")).toHaveAttribute("data-state", "closed"));
    expect(milestones()).toHaveLength(0);
    expect(useUi.getState().toasts.map((t) => t.title)).toEqual(["Tag abgeschlossen"]);
    expect(useUi.getState().toasts[0]!.detail).toBe("Noch offen: Notiz oder Check-in.");
    expect(spies.vibrate).not.toHaveBeenCalled();
    expect(spies.tone).not.toHaveBeenCalled();
    expect(dayClosesOf(useJournal.getState().settings)["2026-06-10"]).toMatchObject({ closed: true, ready: false });
    expect(screen.getByTestId("day-close-state")).toHaveTextContent("Heute abgeschlossen um");
    // it can be taken back
    fireEvent.click(screen.getByTestId("day-close-reopen"));
    await waitFor(() => expect(screen.getByTestId("day-close")).toHaveAttribute("data-state", "open"));
  });

  it("closing after the process is done earns ONE quiet confirmation (a written note counts on a day without trades)", async () => {
    await load(askTrades(), { "2026-06-10": { note: "Pause, nichts getradet – Woche durchgesehen", updatedAt: "2026-06-10T10:00:00Z" } });
    renderView();
    expect(await screen.findByTestId("day-close")).toHaveAttribute("data-ready", "yes");
    fireEvent.click(screen.getByTestId("day-close-done"));
    await waitFor(() => expect(milestones()).toHaveLength(1));
    const t = milestones()[0]!;
    expect(t.title).toBe("Tag abgeschlossen");
    expect(`${t.title} ${t.detail}`).not.toMatch(/\d|Gewinn|Verlust|Profit/);
    expect(dayClosesOf(useJournal.getState().settings)["2026-06-10"]).toMatchObject({ closed: true, ready: true });
    // vibration and tone stayed off (default)
    expect(spies.vibrate).not.toHaveBeenCalled();
    expect(spies.tone).not.toHaveBeenCalled();
  });

  it("a huge unreviewed WIN today earns nothing – the profit is not a reason", async () => {
    const win = mkTrade({ id: "BIG", date: "2026-06-10T09:00", exitDate: "2026-06-10T09:30", entry: 100, stop: 99, size: 10_000, pnlManual: 9_999, setups: ["s_fa"], reason: "Plan" });
    await load([...askTrades(), win]);
    renderView();
    const card = await screen.findByTestId("day-close");
    expect(card).toHaveAttribute("data-ready", "no");
    expect(screen.getByTestId("day-close-item-review")).toHaveAttribute("data-state", "open");
    fireEvent.click(screen.getByTestId("day-close-done"));
    await waitFor(() => expect(card).toHaveAttribute("data-state", "closed"));
    expect(milestones()).toHaveLength(0);
  });

  it("a big LOSS that was reviewed and ticked earns the same confirmation as any finished process – the loss is not a reason either way", async () => {
    const loss = mkTrade({ id: "BAD", date: "2026-06-10T09:00", exitDate: "2026-06-10T09:30", entry: 100, stop: 99, size: 10_000, pnlManual: -9_999, setups: ["s_fa"], reason: "Plan", notes: "Stopp zu weit, nächstes Mal enger" });
    await load([...askTrades(), loss]);
    renderView();
    const card = await screen.findByTestId("day-close");
    expect(card).toHaveAttribute("data-ready", "yes");
    fireEvent.click(screen.getByTestId("day-close-done"));
    await waitFor(() => expect(milestones()).toHaveLength(1));
  });

  it("many trades are no reason: five trades with their reviews close exactly like one", async () => {
    const mk = (i: number, note: string) => mkTrade({ id: `M${i}`, date: `2026-06-10T0${i + 1}:00`, exitDate: `2026-06-10T0${i + 1}:30`, entry: 100, stop: 99, size: 10_000, pnlManual: i % 2 ? 50 : -50, setups: ["s_fa"], reason: "Plan", notes: note });
    await load([...askTrades(), ...[0, 1, 2, 3, 4].map((i) => mk(i, "geprüft"))]);
    renderView();
    expect(await screen.findByTestId("day-close")).toHaveAttribute("data-ready", "yes");
    fireEvent.click(screen.getByTestId("day-close-done"));
    await waitFor(() => expect(milestones()).toHaveLength(1));
  });

  it("vibration only after the person switched it on – and never under reduced motion; the tone follows its own switch", async () => {
    await load(askTrades(), { "2026-06-10": { note: "ok", updatedAt: "2026-06-10T10:00:00Z" } });
    feedback.useFeedbackPref.setState({ sound: true, haptic: true });
    renderView();
    fireEvent.click(await screen.findByTestId("day-close-done"));
    await waitFor(() => expect(milestones()).toHaveLength(1));
    // reduced motion (this describe's setting) = no vibration; the tone is not motion
    expect(spies.vibrate).not.toHaveBeenCalled();
    expect(spies.tone).toHaveBeenCalledTimes(1);
  });

  it("the switches in the ritual are the shared preference: flipping one writes it (default OFF)", async () => {
    await load();
    renderView();
    const haptic = await screen.findByTestId("day-close-haptic");
    expect(feedback.useFeedbackPref.getState().haptic).toBe(false);
    fireEvent.click(haptic);
    expect(feedback.useFeedbackPref.getState().haptic).toBe(true);
    expect(screen.getByTestId("day-close-sound")).toHaveAttribute("aria-checked", "false");
  });

  it("the week card (finished KW 19) uses the SAME ritual: its dots read „n von 7 Tagen“, no second system", async () => {
    await load();
    useBerichteUi.getState().setPeriod("2026-W19");
    renderView();
    const card = await screen.findByTestId("week-close");
    expect(within(card).getByTestId("week-close-ritual")).toBeInTheDocument();
    // 4.–10.5.: Monday has T1 with its review; the other days are neutral
    expect(within(card).getByTestId("week-close-days-text")).toHaveTextContent("1 von 7 Tagen mit Rückblick");
    expect(screen.queryByTestId("day-close")).toBeNull();
    expect(within(card).getByTestId("week-close-haptic")).toBeInTheDocument();
  });

  it("the journal card sits in the same report and turns through the period's own entries (KW 19: T1, T2, T3)", async () => {
    await load();
    useBerichteUi.getState().setPeriod("2026-W19");
    renderView();
    const card = await screen.findByTestId("journal-cards");
    expect(within(card).getByTestId("journal-pill")).toHaveTextContent("Eintrag 01 von 03");
    fireEvent.click(within(card).getByTestId("journal-next"));
    fireEvent.click(within(card).getByTestId("journal-next"));
    expect(within(card).getByTestId("journal-pill")).toHaveTextContent("Eintrag 03 von 03");
    expect(within(card).getByTestId("journal-entry")).toHaveAttribute("data-id", "T3");
    expect(within(card).getByTestId("journal-r")).toHaveTextContent("−1,50 R");
  });

  it("the question bar is lazy but there: a question over the whole journal, in the report page", async () => {
    await load();
    useBerichteUi.getState().setPeriod("2026-W19");
    renderView();
    const ask = await screen.findByTestId("ask-journal", undefined, { timeout: 5000 });
    expect(ask).toBeInTheDocument();
    fireEvent.click(within(ask).getByTestId("ask-open"));
    fireEvent.change(within(ask).getByTestId("ask-input"), { target: { value: "Trades ohne Stopp" } });
    fireEvent.click(within(ask).getByTestId("ask-send"));
    await waitFor(() => expect(within(ask).getAllByTestId("ask-card")).toHaveLength(3));
    expect(within(ask).getAllByTestId("ask-card-value")[0]).toHaveTextContent("2 von 12 (17 %)");
  });
});
