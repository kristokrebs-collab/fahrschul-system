import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { useState } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MorphCard, MorphTitle } from "@/motion/MorphCard";
import { MorphDialogProvider, useMorphDialog, useMorphDialogGuard } from "@/motion/MorphDialog";
import { MotionRoot } from "@/motion/MotionRoot";
import { Sheet } from "@/motion/Sheet";
import { backStackState, depthOf, installBackStack } from "@/store/backStack";
import { installRouter, navigate } from "@/store/router";
import { DEFAULT_TRADE_FILTER, useUi } from "@/store/uiStore";

/**
 * Android back (decision 26) through the real dialog components and jsdom's session history (asynchronous
 * `history.back()` with `popstate` / `hashchange`, like the browser): back runs the dialog's Escape path, the unsaved
 * input guard keeps it open and gets the entry back, nested dialogs close from the top, and only then does back reach
 * the router.
 */
const depth = () => depthOf(history.state);
/** The layer is idle: no own traversal under way and the history depth equals the open dialogs. */
const idle = () => {
  const s = backStackState();
  return s.pending === 0 && s.have === s.want && s.have === depth();
};
const press = (name: string) => fireEvent.click(screen.getByRole("button", { name }));

function Editor({ onClose }: { onClose?: () => void }) {
  const [open, setOpen] = useState(true);
  return (
    <MotionRoot>
      <button type="button">Seite</button>
      <Sheet
        open={open}
        onClose={() => {
          onClose?.();
          setOpen(false);
        }}
        title="Trade eintragen"
      >
        <input aria-label="Einstieg" />
        <button type="button" onClick={() => setOpen(false)}>
          Speichern
        </button>
      </Sheet>
    </MotionRoot>
  );
}

function Nested({ log }: { log: string[] }) {
  const [outer, setOuter] = useState(true);
  const [inner, setInner] = useState(false);
  return (
    <MotionRoot>
      <Sheet
        open={outer}
        onClose={() => {
          log.push("outer");
          setOuter(false);
        }}
        title="Trade eintragen"
      >
        <button type="button" onClick={() => setInner(true)}>
          + Neue Grundlage
        </button>
      </Sheet>
      <Sheet
        open={inner}
        onClose={() => {
          log.push("inner");
          setInner(false);
        }}
        title="Neue Grundlage"
      >
        <p>Formular</p>
      </Sheet>
    </MotionRoot>
  );
}

describe("back closes the topmost dialog (jsdom history)", () => {
  let uninstall: () => void = () => {};
  beforeEach(() => {
    history.replaceState(null, "", "#overview");
    // the router's scroll restore (jsdom has no scrolling)
    vi.spyOn(window, "scrollTo").mockImplementation(() => {});
  });
  afterEach(() => {
    uninstall();
    vi.restoreAllMocks();
  });

  it("a sheet: back runs its close path, the entry is gone and nothing else moves", async () => {
    uninstall = installBackStack();
    const onClose = vi.fn();
    render(<Editor onClose={onClose} />);
    await waitFor(() => expect(depth()).toBe(1));
    const href = location.href;
    act(() => history.back());
    await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(idle()).toBe(true));
    expect(depth()).toBe(0);
    expect(location.href).toBe(href);
  });

  it("unsaved input: back asks `Änderungen verwerfen?` and keeps the sheet with its entry; Verwerfen closes and consumes it", async () => {
    uninstall = installBackStack();
    const onClose = vi.fn();
    render(<Editor onClose={onClose} />);
    await waitFor(() => expect(depth()).toBe(1));
    fireEvent.input(screen.getByRole("textbox", { name: "Einstieg" }), { target: { value: "80123" } });

    act(() => history.back());
    await waitFor(() => expect(screen.getByText("Änderungen verwerfen?")).toBeInTheDocument());
    // still open, its entry pushed again → the next back works again
    await waitFor(() => expect(depth()).toBe(1));
    expect(onClose).not.toHaveBeenCalled();
    expect(screen.getByRole("textbox", { name: "Einstieg" })).toHaveValue("80123");

    press("Weiter bearbeiten");
    await waitFor(() => expect(screen.queryByText("Änderungen verwerfen?")).toBeNull());
    act(() => history.back());
    await waitFor(() => expect(screen.getByText("Änderungen verwerfen?")).toBeInTheDocument());
    await waitFor(() => expect(depth()).toBe(1));

    press("Verwerfen");
    expect(onClose).toHaveBeenCalledTimes(1);
    // the programmatic close consumed the re-pushed entry with an own back nobody reacted to
    await waitFor(() => expect(idle()).toBe(true));
    expect(depth()).toBe(0);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("closing by a button consumes the entry; the history does not grow over repeated cycles", async () => {
    uninstall = installBackStack();
    const start = history.length;
    for (let i = 0; i < 4; i += 1) {
      const { unmount } = render(<Editor />);
      await waitFor(() => expect(depth()).toBe(1));
      press("Speichern");
      await waitFor(() => expect(idle()).toBe(true));
      expect(depth()).toBe(0);
      unmount();
    }
    expect(history.length).toBeLessThanOrEqual(start + 1);
  });

  it("nested sheets: back closes the inner one, then the outer one", async () => {
    uninstall = installBackStack();
    const log: string[] = [];
    render(<Nested log={log} />);
    await waitFor(() => expect(depth()).toBe(1));
    press("+ Neue Grundlage");
    await waitFor(() => expect(depth()).toBe(2));
    act(() => history.back());
    await waitFor(() => expect(log).toEqual(["inner"]));
    await waitFor(() => expect(idle()).toBe(true));
    expect(depth()).toBe(1);
    act(() => history.back());
    await waitFor(() => expect(log).toEqual(["inner", "outer"]));
    await waitFor(() => expect(idle()).toBe(true));
    expect(depth()).toBe(0);
  });

  it("a morph dialog with a dirty body: back asks the body; its own close consumes the entry", async () => {
    uninstall = installBackStack();
    const onAttempt = vi.fn();
    function Body() {
      const { close } = useMorphDialog();
      useMorphDialogGuard(() => true, onAttempt);
      return (
        <button type="button" onClick={close}>
          Verwerfen
        </button>
      );
    }
    render(
      <MotionRoot>
        <MorphDialogProvider>
          <MorphCard id="knife" title="Falling-Knife-Filter" body={() => <Body />}>
            <MorphTitle id="knife">Falling-Knife-Filter</MorphTitle>
          </MorphCard>
        </MorphDialogProvider>
      </MotionRoot>,
    );
    const card = screen.getByRole("button", { name: /Falling-Knife-Filter/ });
    fireEvent.click(card);
    await waitFor(() => expect(depth()).toBe(1));
    act(() => history.back());
    await waitFor(() => expect(onAttempt).toHaveBeenCalledTimes(1));
    expect(card).toHaveAttribute("aria-expanded", "true");
    await waitFor(() => expect(depth()).toBe(1));
    press("Verwerfen");
    expect(card).toHaveAttribute("aria-expanded", "false");
    await waitFor(() => expect(idle()).toBe(true));
    expect(depth()).toBe(0);
  });

  it("with the router: back closes the dialog without switching the page, the next back switches it", async () => {
    useUi.setState({ page: "overview", tradeFilter: DEFAULT_TRADE_FILTER });
    uninstall = installRouter();
    navigate("trades");
    expect(location.hash).toBe("#trades");
    const onClose = vi.fn();
    render(<Editor onClose={onClose} />);
    await waitFor(() => expect(depth()).toBe(1));

    act(() => history.back());
    await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(idle()).toBe(true));
    expect(useUi.getState().page).toBe("trades");
    expect(location.hash).toBe("#trades");

    act(() => history.back());
    await waitFor(() => expect(useUi.getState().page).toBe("overview"));
    expect(location.hash).toBe("#overview");
  });

  it("with the router: a filter written into the dialog's entry is kept when back closes the dialog", async () => {
    useUi.setState({ page: "overview", tradeFilter: DEFAULT_TRADE_FILTER });
    uninstall = installRouter();
    navigate("trades");
    render(<Editor />);
    await waitFor(() => expect(depth()).toBe(1));
    // the debounced search mirror lands while the dialog is open
    act(() => useUi.getState().setTradeFilter({ result: "win" }));
    expect(location.hash).toBe("#trades?result=win");
    expect(depth()).toBe(1);
    act(() => history.back());
    await waitFor(() => expect(idle()).toBe(true));
    // the page entry's older URL produced a hashchange: no route change, the URL follows the UI again
    await waitFor(() => expect(location.hash).toBe("#trades?result=win"));
    expect(useUi.getState().page).toBe("trades");
    expect(useUi.getState().tradeFilter.result).toBe("win");
  });
});
