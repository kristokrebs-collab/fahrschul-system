/**
 * The short trade form (Etappe 1b): the core of six fields, the accordion groups, `Felder anpassen` (per device) and
 * `Letzten Trade duplizieren`. The data paths of every field are covered by the older editor specs (they keep all
 * fields on screen); here the LAYOUT is under test.
 */
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MotionRoot } from "@/motion/MotionRoot";
import { TradeEditor, type TradeRecord } from "@/overlays/TradeEditor";
import { GROUPS, defaultLayout, layoutKey, moveField, writeLayout } from "@/overlays/tradeFormLayout";
import { useJournal } from "@/store/journalStore";
import { useUi } from "@/store/uiStore";
import { SAMPLE, settings } from "./domain.fixtures";

const saveTrade = vi.fn<(t: TradeRecord) => Promise<void>>(async () => {});

function seed(editor: { open: boolean; tradeId?: string }, trades = SAMPLE) {
  saveTrade.mockClear();
  useJournal.setState({ trades, settings: settings(), loaded: true, mode: "local", saveTrade, deleteTrade: vi.fn(async () => {}) });
  useUi.setState({ acc: "all", editor: { open: editor.open, tradeId: editor.tradeId, fromFab: false }, setupEditor: { open: false, fromTrade: false }, toasts: [] });
}
const mount = () =>
  render(
    <MotionRoot>
      <TradeEditor />
    </MotionRoot>,
  );

const input = (label: string) => screen.getByLabelText(label) as HTMLInputElement;
const type = (label: string, value: string) => fireEvent.change(input(label), { target: { value } });
const groupButton = (title: string) => screen.getByRole("button", { name: new RegExp(`^${title}`) });
/** True while the control sits in a closed (inert) group. */
const hidden = (el: Element) => el.closest("[inert]") != null;

beforeEach(() => {
  localStorage.removeItem(layoutKey());
  seed({ open: true });
});
afterEach(() => localStorage.removeItem(layoutKey()));

describe("short trade form – core and groups", () => {
  it("opens with the six core fields; the six groups are closed and their controls are out of reach", () => {
    mount();
    expect(screen.getByRole("heading", { level: 3, name: /Kernfelder/ })).toBeInTheDocument();
    const core = screen.getByTestId("form-core");
    for (const l of ["Paar", "Datum & Uhrzeit", "Einstieg", "Ausstieg", "Größe (USDT)"]) expect(within(core).getByLabelText(l)).toBeInTheDocument();
    expect(within(core).getByRole("radiogroup", { name: "Richtung" })).toBeInTheDocument();
    for (const g of GROUPS) {
      const b = groupButton(g.title);
      expect(b).toHaveAttribute("aria-expanded", "false");
      expect(screen.getByTestId(`form-group-${g.id}`).querySelector("[data-group-body]")).toHaveAttribute("inert");
    }
    for (const l of ["Stop-Loss", "Take-Profit", "Hebel", "Gebühren (USDT)", "P&L manuell", "Begründung", "Learnings & Notizen", "Chart-Link (TradingView)"]) expect(hidden(input(l))).toBe(true);
    for (const l of ["Paar", "Einstieg", "Ausstieg", "Größe (USDT)"]) expect(hidden(input(l))).toBe(false);
    // the save bar is the editor's own, unchanged
    expect(screen.getByRole("button", { name: "Speichern" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Speichern & neu" })).toBeInTheDocument();
  });

  it("a group opens and closes by its header; the content stays mounted", () => {
    mount();
    const stop = input("Stop-Loss");
    fireEvent.click(groupButton("Ziele und Ausstieg"));
    expect(groupButton("Ziele und Ausstieg")).toHaveAttribute("aria-expanded", "true");
    expect(hidden(stop)).toBe(false);
    fireEvent.change(stop, { target: { value: "79000" } });
    fireEvent.click(groupButton("Ziele und Ausstieg"));
    expect(groupButton("Ziele und Ausstieg")).toHaveAttribute("aria-expanded", "false");
    expect(hidden(stop)).toBe(true);
    expect(input("Stop-Loss").value).toBe("79000"); // nothing is lost by closing
  });

  it("saves a trade with the six core fields alone", async () => {
    mount();
    type("Einstieg", "80000");
    type("Ausstieg", "81000");
    type("Größe (USDT)", "1000");
    fireEvent.click(screen.getByRole("button", { name: "Speichern" }));
    await waitFor(() => expect(saveTrade).toHaveBeenCalledTimes(1));
    expect(saveTrade.mock.calls[0]?.[0]).toMatchObject({ entry: 80000, exit: 81000, size: 1000, side: "long", status: "closed", pair: settings().pair });
    expect(useUi.getState().toasts.map((t) => t.title)).toContain("Trade gespeichert");
  });

  it("values typed into a closed group are saved (the data format is unchanged)", async () => {
    mount();
    type("Einstieg", "80000");
    type("Ausstieg", "84000");
    type("Größe (USDT)", "8000");
    type("Stop-Loss", "79000");
    type("Learnings & Notizen", "nachgetragen");
    fireEvent.click(screen.getByRole("button", { name: "Speichern" }));
    await waitFor(() => expect(saveTrade).toHaveBeenCalledTimes(1));
    expect(saveTrade.mock.calls[0]?.[0]).toMatchObject({ stop: 79000, notes: "nachgetragen", r: expect.any(Number) });
  });

  it("a group says how many of its fields are filled", () => {
    mount();
    expect(screen.queryByTestId("form-group-notes-filled")).not.toBeInTheDocument();
    expect(screen.queryByTestId("form-group-targets-filled")).not.toBeInTheDocument(); // the default leverage is not the trader's value
    type("Learnings & Notizen", "x");
    type("Chart-Link (TradingView)", "https://www.tradingview.com/x/1");
    expect(screen.getByTestId("form-group-notes-filled")).toHaveTextContent("2 ausgefüllt");
    type("Stop-Loss", "79000");
    expect(screen.getByTestId("form-group-targets-filled")).toHaveTextContent("1 ausgefüllt");
  });

  it("the P&L and R preview stays under the core; the three risk tiles ride with `Ziele und Ausstieg`", () => {
    mount();
    type("Einstieg", "80000");
    type("Stop-Loss", "79000");
    type("Ausstieg", "84000");
    type("Größe (USDT)", "8000");
    const live = screen.getByRole("group", { name: "Live-Vorschau" });
    expect(within(live).getByText("P&L")).toBeInTheDocument();
    expect(within(live).getByText("R-Multiple")).toBeInTheDocument();
    expect(within(live).queryByText("Risiko")).not.toBeInTheDocument();
    const risk = document.querySelector<HTMLElement>('[aria-label="Risiko-Vorschau"]')!;
    expect(risk).toBeTruthy();
    expect(hidden(risk)).toBe(true);
    expect(screen.getByTestId("form-group-targets")).toContainElement(risk);
    for (const l of ["Kursbewegung", "Risiko", "Geplantes CRV"]) expect(within(risk).getByText(l)).toBeInTheDocument();
  });
});

describe("short trade form – an error opens the group and jumps to the field", () => {
  it("a required field that sits in a closed group: group opens, field is focused, message shown", async () => {
    writeLayout(moveField(defaultLayout(), "entry", "details"));
    mount();
    expect(hidden(input("Einstieg"))).toBe(true);
    fireEvent.click(screen.getByRole("button", { name: "Speichern" }));
    expect(screen.getByRole("alert")).toHaveTextContent("Bitte einen Einstiegspreis angeben.");
    expect(groupButton("Details")).toHaveAttribute("aria-expanded", "true");
    await waitFor(() => expect(document.activeElement).toBe(input("Einstieg")));
    expect(input("Einstieg")).toHaveAttribute("aria-invalid", "true");
    expect(hidden(input("Einstieg"))).toBe(false);
    expect(saveTrade).not.toHaveBeenCalled();
  });

  it("a field in the core is focused at once, no group opens", () => {
    mount();
    fireEvent.click(screen.getByRole("button", { name: "Speichern" }));
    expect(document.activeElement).toBe(input("Einstieg"));
    for (const g of GROUPS) expect(groupButton(g.title)).toHaveAttribute("aria-expanded", "false");
  });

  it("an error of the execution block (incomplete fill) opens `Ausführung`", async () => {
    mount();
    type("Einstieg", "80000");
    type("Ausstieg", "81000");
    type("Größe (USDT)", "1000");
    fireEvent.click(groupButton("Ausführung"));
    fireEvent.click(screen.getByRole("button", { name: "+ Einstieg" }));
    fireEvent.change(screen.getByLabelText(/Fill 1 Preis/), { target: { value: "80000" } });
    fireEvent.click(groupButton("Ausführung")); // close it again: the error must open it
    expect(groupButton("Ausführung")).toHaveAttribute("aria-expanded", "false");
    fireEvent.click(screen.getByRole("button", { name: "Speichern" }));
    expect(screen.getByRole("alert")).toHaveTextContent("Ein Fill ist unvollständig");
    expect(groupButton("Ausführung")).toHaveAttribute("aria-expanded", "true");
    await waitFor(() => expect(document.activeElement?.id).toBe("fb-execution"));
  });
});

describe("short trade form – Felder anpassen", () => {
  it("moves a field into the core, keeps it across a reload (new mount) and resets", () => {
    const first = mount();
    fireEvent.click(screen.getByTestId("customize-open"));
    expect(screen.getByTestId("field-customizer")).toBeInTheDocument();
    expect(screen.getByTestId("customize-core-count")).toHaveTextContent("Kern: 6 Felder");
    expect(screen.getByTestId("customize-reset")).toBeDisabled();
    expect(screen.getAllByRole("listitem").length).toBeGreaterThanOrEqual(29);

    fireEvent.change(screen.getByTestId("cz-stop"), { target: { value: "core" } });
    expect(screen.getByTestId("customize-core-count")).toHaveTextContent("Kern: 7 Felder");
    expect(JSON.parse(localStorage.getItem(layoutKey()) ?? "null")).toEqual({ v: 1, moved: { stop: "core" } });
    fireEvent.click(screen.getByTestId("customize-done"));
    expect(screen.queryByTestId("field-customizer")).not.toBeInTheDocument();
    expect(within(screen.getByTestId("form-core")).getByLabelText("Stop-Loss")).toBeInTheDocument();
    expect(hidden(input("Stop-Loss"))).toBe(false);

    // "Neuladen": a fresh mount reads the stored layout
    first.unmount();
    seed({ open: true });
    mount();
    expect(within(screen.getByTestId("form-core")).getByLabelText("Stop-Loss")).toBeInTheDocument();

    fireEvent.click(screen.getByTestId("customize-open"));
    fireEvent.click(screen.getByTestId("customize-reset"));
    expect(screen.getByTestId("customize-note")).toHaveTextContent("Auf die Voreinstellung zurückgesetzt.");
    expect(localStorage.getItem(layoutKey())).toBeNull();
    expect(screen.getByTestId("customize-core-count")).toHaveTextContent("Kern: 6 Felder");
    fireEvent.click(screen.getByTestId("customize-done"));
    expect(within(screen.getByTestId("form-core")).queryByLabelText("Stop-Loss")).not.toBeInTheDocument();
  });

  it("a field moved into a group leaves the core; a group with no field left disappears; nothing typed is lost", () => {
    mount();
    type("Einstieg", "80123");
    fireEvent.click(screen.getByTestId("customize-open"));
    fireEvent.change(screen.getByTestId("cz-entry"), { target: { value: "notes" } });
    for (const id of ["account", "timeframe", "status"]) fireEvent.change(screen.getByTestId(`cz-${id}`), { target: { value: "core" } });
    fireEvent.click(screen.getByTestId("customize-done"));
    expect(screen.queryByTestId("form-group-details")).not.toBeInTheDocument();
    expect(within(screen.getByTestId("form-core")).queryByLabelText("Einstieg")).not.toBeInTheDocument();
    expect(input("Einstieg").value).toBe("80123");
    expect(screen.getByTestId("form-group-notes")).toContainElement(input("Einstieg"));
  });

  it("a stored layout from a blocked or broken storage falls back to the default", () => {
    localStorage.setItem(layoutKey(), "{kaputt");
    mount();
    expect(within(screen.getByTestId("form-core")).getByLabelText("Einstieg")).toBeInTheDocument();
    expect(screen.getByTestId("form-group-targets")).toBeInTheDocument();
  });

  it("the customise list names every field and offers the core plus the six groups", () => {
    mount();
    fireEvent.click(screen.getByTestId("customize-open"));
    const select = screen.getByTestId("cz-notes") as HTMLSelectElement;
    expect(Array.from(select.options).map((o) => o.textContent)).toEqual(["Kern (immer sichtbar)", ...GROUPS.map((g) => g.title)]);
    expect(select.value).toBe("notes");
  });
});

describe("short trade form – Letzten Trade duplizieren", () => {
  it("takes the last trade's setting over and says so; prices, result, times and notes stay empty", () => {
    mount();
    const last = [...SAMPLE].sort((a, b) => b.date.localeCompare(a.date))[0]!;
    expect(screen.getByTestId("duplicate-note")).toHaveTextContent("ohne Preise, Ergebnis, Zeiten und Notizen");
    fireEvent.click(screen.getByRole("radio", { name: "▼ Short" }));
    type("Einstieg", "80000");
    act(() => fireEvent.click(screen.getByTestId("duplicate-last")));
    const note = screen.getByTestId("duplicate-note");
    expect(note).toHaveTextContent(/^Vom letzten Trade übernommen: Symbol BTC\/USDT, Richtung Long, Setup „.+“, Größe 8\.000 USDT und Zeitrahmen 4h – ohne Preise, Ergebnis, Zeiten und Notizen\.$/);
    expect(input("Größe (USDT)").value).toBe(String(last.size));
    expect(input("Paar").value).toBe(last.pair);
    expect(screen.getByRole("radio", { name: "▲ Long" })).toHaveAttribute("aria-checked", "true");
    expect(screen.getByText(/Backtest-Signal/, { selector: "button" })).toHaveAttribute("aria-pressed", "true"); // the setup chip (its group stays closed)
    // only the setting: the typed entry price is untouched (not part of a duplicate), the rest stays blank
    expect(input("Einstieg").value).toBe("80000");
    expect(input("Ausstieg").value).toBe("");
    expect(input("Learnings & Notizen").value).toBe("");
    expect(input("Begründung").value).toBe("");
  });

  it("is a start: duplicate, add the prices, save – the new trade carries pair, side, setup and size of the last", async () => {
    mount();
    fireEvent.click(screen.getByTestId("duplicate-last"));
    type("Einstieg", "80000");
    type("Ausstieg", "81000");
    fireEvent.click(screen.getByRole("button", { name: "Speichern" }));
    await waitFor(() => expect(saveTrade).toHaveBeenCalledTimes(1));
    const rec = saveTrade.mock.calls[0]![0];
    expect(rec).toMatchObject({ pair: "BTC/USDT", side: "long", size: 8000, timeframe: "4h", setups: ["s_bt"], entry: 80000, exit: 81000 });
    expect(rec).not.toHaveProperty("id");
    expect(rec.notes).toBe("");
    expect(rec.emotion).toBe("");
    expect(rec.conviction).toBeNull();
  });

  it("is offered only on a new trade and only when the journal has a trade", () => {
    seed({ open: true }, []);
    const first = mount();
    expect(screen.queryByTestId("duplicate-last")).not.toBeInTheDocument();
    expect(screen.getByTestId("customize-open")).toBeInTheDocument();
    first.unmount();
    seed({ open: true, tradeId: "A" });
    mount();
    expect(screen.queryByTestId("duplicate-last")).not.toBeInTheDocument();
  });
});

describe("short trade form – a draft shows what it filled", () => {
  it("opens the groups that hold the draft's values, leaves the others closed", () => {
    useUi.setState({ editor: { open: true, fromFab: false, draft: { pair: "ETH/USDT", entry: 3000, stop: 2900, notes: "aus dem Screenshot" }, draftSeq: 1 } });
    mount();
    expect(groupButton("Ziele und Ausstieg")).toHaveAttribute("aria-expanded", "true");
    expect(groupButton("Notizen und Bewertung")).toHaveAttribute("aria-expanded", "true");
    expect(groupButton("Details")).toHaveAttribute("aria-expanded", "false");
    expect(input("Stop-Loss").value).toBe("2900");
  });
});
