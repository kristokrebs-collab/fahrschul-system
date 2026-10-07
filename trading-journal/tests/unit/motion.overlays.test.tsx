import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { useState } from "react";
import { describe, expect, it, vi } from "vitest";
import { MorphCard, MorphTitle } from "@/motion/MorphCard";
import { MorphDialogProvider, StaggerItem, useMorphDialog, useMorphDialogGuard } from "@/motion/MorphDialog";
import { MotionRoot } from "@/motion/MotionRoot";
import { PageSwitch } from "@/motion/PageSwitch";
import { Sheet } from "@/motion/Sheet";

describe("Sheet", () => {
  it("morph sheet: no shadow on the morphing panel, an unscaled shadow sibling; inert + body wait for the morph", async () => {
    function H() {
      const [open, setOpen] = useState(true);
      return (
        <MotionRoot>
          <button type="button">Draußen</button>
          <Sheet open={open} onClose={() => setOpen(false)} title="Trade eintragen" size="lg" layoutId="new-trade">
            <StaggerItem>
              <p>Abschnitt</p>
            </StaggerItem>
          </Sheet>
        </MotionRoot>
      );
    }
    render(<H />);
    const dialog = screen.getByRole("dialog", { name: "Trade eintragen" });
    expect(dialog.className).not.toContain("shadow-[");
    expect(dialog.className).toContain("sm:max-w-[860px]");
    const shadow = dialog.parentElement?.querySelector(":scope > [aria-hidden='true']");
    expect(shadow?.className).toContain("shadow-[");
    const outside = screen.getByRole("button", { name: "Draußen", hidden: true });
    // focus moved at once, the page is not inert yet and the body waits for the morph: it is laid out at once (so the
    // morph targets the final box) but hidden and inert until the morph has finished
    expect(dialog.contains(document.activeElement)).toBe(true);
    expect(outside).not.toHaveAttribute("inert");
    expect(screen.getByText("Abschnitt").closest("[inert]")).not.toBeNull();
    // no source in the DOM → the morph fallback reveals the body, then the page becomes inert
    await waitFor(() => expect(screen.getByText("Abschnitt").closest("[inert]")).toBeNull(), { timeout: 1500 });
    await waitFor(() => expect(outside).toHaveAttribute("inert"), { timeout: 1500 });
    fireEvent.keyDown(document, { key: "Escape" });
    await waitFor(() => expect(outside).not.toHaveAttribute("inert"), { timeout: 1500 });
  });

  it("sliding sheet keeps its own shadow and inerts the page immediately", () => {
    render(
      <MotionRoot>
        <button type="button">Draußen</button>
        <Sheet open onClose={() => {}} title="Grundlage bearbeiten">
          <p>Formular</p>
        </Sheet>
      </MotionRoot>,
    );
    expect(screen.getByRole("dialog", { name: "Grundlage bearbeiten" }).className).toContain("shadow-[");
    expect(screen.getByRole("button", { name: "Draußen", hidden: true })).toHaveAttribute("inert");
    expect(screen.getByText("Formular")).toBeInTheDocument();
  });
});

describe("StaggerItem", () => {
  it("renders statically outside a stagger parent", () => {
    render(
      <StaggerItem as="section" className="x">
        <p>Inhalt</p>
      </StaggerItem>,
    );
    const section = screen.getByText("Inhalt").parentElement as HTMLElement;
    expect(section.tagName).toBe("SECTION");
    expect(section.style.opacity).not.toBe("0");
  });
});

describe("MorphDialog", () => {
  it("body sections stagger in; after Escape inert is lifted and focus returns to the card", async () => {
    render(
      <MotionRoot>
        <MorphDialogProvider>
          <MorphCard
            id="fact-net"
            title="Netto-P&L"
            body={() => (
              <>
                <StaggerItem>
                  <p>Was</p>
                </StaggerItem>
                <StaggerItem>
                  <p>Formel</p>
                </StaggerItem>
              </>
            )}
          >
            <MorphTitle id="fact-net">Netto-P&L</MorphTitle>
          </MorphCard>
          <button type="button">Anderer</button>
        </MorphDialogProvider>
      </MotionRoot>,
    );
    const card = screen.getByRole("button", { name: /Netto-P&L/ });
    card.focus();
    fireEvent.click(card);
    const dialog = screen.getByRole("dialog");
    expect(dialog.contains(document.activeElement)).toBe(true);
    expect(screen.getByText("Formel")).toBeInTheDocument();
    await waitFor(() => expect(screen.getByRole("button", { name: "Anderer", hidden: true })).toHaveAttribute("inert"), { timeout: 1500 });
    fireEvent.keyDown(document, { key: "Escape" });
    await waitFor(() => expect(screen.getByRole("button", { name: "Anderer" })).not.toHaveAttribute("inert"), { timeout: 1500 });
    await waitFor(() => expect(document.activeElement).toBe(card), { timeout: 1500 });
  });
});

describe("MorphDialog backdrop", () => {
  it("closes on a click on the (never inert) overlay wrapper, not on the panel", async () => {
    render(
      <MotionRoot>
        <MorphDialogProvider>
          <MorphCard id="fact-pf" title="Profit-Faktor" body={() => <p>Erklärung</p>}>
            <MorphTitle id="fact-pf">Profit-Faktor</MorphTitle>
          </MorphCard>
        </MorphDialogProvider>
      </MotionRoot>,
    );
    const card = screen.getByRole("button", { name: /Profit-Faktor/ });
    fireEvent.click(card);
    const dialog = screen.getByRole("dialog");
    const overlay = dialog.closest(".fixed") as HTMLElement;
    // once the page behind is inert, the overlay wrapper (an ancestor of the panel) is still live
    await waitFor(() => expect(card).toHaveAttribute("inert"), { timeout: 1500 });
    expect(overlay).not.toHaveAttribute("inert");
    fireEvent.click(dialog);
    expect(card).toHaveAttribute("aria-expanded", "true");
    fireEvent.click(overlay);
    // (jsdom never finishes the shared-layout exit, so assert the close itself rather than the unmount)
    expect(card).toHaveAttribute("aria-expanded", "false");
  });
});

/** A dialog body with an unsaved-input guard (like HyblockForm). */
function GuardedBody({ onAttempt }: { onAttempt: () => void }) {
  const [dirty, setDirty] = useState(false);
  const { close } = useMorphDialog();
  useMorphDialogGuard(() => dirty, onAttempt);
  return (
    <>
      <button type="button" onClick={() => setDirty(true)}>
        Tippen
      </button>
      <button type="button" onClick={close}>
        Verwerfen
      </button>
    </>
  );
}

describe("MorphDialog unsaved-input guard", () => {
  it("Escape, backdrop and × ask a dirty body instead of closing; the body's own close is never guarded", async () => {
    const onAttempt = vi.fn();
    render(
      <MotionRoot>
        <MorphDialogProvider>
          <MorphCard id="guarded" title="Ablesung" body={() => <GuardedBody onAttempt={onAttempt} />}>
            <MorphTitle id="guarded">Ablesung</MorphTitle>
          </MorphCard>
        </MorphDialogProvider>
      </MotionRoot>,
    );
    const card = screen.getByRole("button", { name: /Ablesung/ });
    fireEvent.click(card);
    await waitFor(() => expect(card).toHaveAttribute("inert"), { timeout: 1500 });
    // clean body: Escape closes at once (and the card reopens it)
    fireEvent.keyDown(document, { key: "Escape" });
    expect(card).toHaveAttribute("aria-expanded", "false");
    expect(onAttempt).not.toHaveBeenCalled();
    await waitFor(() => expect(card).not.toHaveAttribute("inert"), { timeout: 1500 });
    fireEvent.click(card);
    await waitFor(() => expect(card).toHaveAttribute("inert"), { timeout: 1500 });
    fireEvent.click(screen.getByRole("button", { name: "Tippen" }));
    fireEvent.keyDown(document, { key: "Escape" });
    fireEvent.click(screen.getByRole("dialog").closest(".fixed") as HTMLElement);
    fireEvent.click(screen.getByRole("button", { name: "Schließen" }));
    expect(onAttempt).toHaveBeenCalledTimes(3);
    expect(card).toHaveAttribute("aria-expanded", "true");
    fireEvent.click(screen.getByRole("button", { name: "Verwerfen" }));
    expect(card).toHaveAttribute("aria-expanded", "false");
  });
});

describe("PageSwitch", () => {
  it("clears `transitioning` once the faster exit and the depth enter have both settled", async () => {
    const onT = vi.fn();
    const { rerender } = render(
      <MotionRoot>
        <PageSwitch index={0} pageKey="o" onTransitioning={onT}>
          <p>Übersicht</p>
        </PageSwitch>
      </MotionRoot>,
    );
    const container = screen.getByText("Übersicht").parentElement?.parentElement as HTMLElement;
    act(() => {
      rerender(
        <MotionRoot>
          <PageSwitch index={1} pageKey="t" onTransitioning={onT}>
            <p>Trades</p>
          </PageSwitch>
        </MotionRoot>,
      );
    });
    expect(onT).toHaveBeenLastCalledWith(true);
    await waitFor(() => expect(onT).toHaveBeenLastCalledWith(false), { timeout: 1500 });
    expect(screen.queryByText("Übersicht")).toBeNull();
    // the container is a plain box: no layout projection transform on it
    expect(container.style.transform).toBe("");
    // the page ends without transform / filter (no containing block for fixed ghosts)
    const page = screen.getByText("Trades").parentElement as HTMLElement;
    await waitFor(() => expect(page.style.filter).toBe("none"));
    expect(page.style.transform === "" || page.style.transform === "none").toBe(true);
  });
});
