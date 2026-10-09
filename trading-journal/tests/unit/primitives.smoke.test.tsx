import { act, fireEvent, render, screen } from "@testing-library/react";
import { useState } from "react";
import { describe, expect, it, vi } from "vitest";
import { MotionRoot } from "@/motion/MotionRoot";
import { MorphDialogProvider } from "@/motion/MorphDialog";
import { MorphCard, MorphTitle } from "@/motion/MorphCard";
import { RollingDigits } from "@/motion/RollingDigits";
import { Sheet } from "@/motion/Sheet";
import { StatusPill } from "@/motion/StatusPill";
import { HoverPill, useHoverGroup } from "@/motion/HoverPill";
import { PageSwitch } from "@/motion/PageSwitch";
import {
  Badge,
  Card,
  ConvictionRadio,
  EmptyState,
  Expander,
  Collapse,
  Field,
  HeroBackdrop,
  Input,
  Label,
  RingGauge,
  SetupChips,
  Skeleton,
  Sparkline,
  SplitText,
  StatTile,
  WarnBanner,
  resample,
} from "@/primitives";

describe("smoke: motion kit renders and behaves in jsdom", () => {
  it("MorphCard opens the shared dialog with title, body and close; Escape closes", () => {
    render(
      <MotionRoot>
        <MorphDialogProvider>
          <div>
            <MorphCard id="fact-net" title="Netto-P&L" body={() => <p>Erklärung</p>} className="rounded-2xl">
              <MorphTitle id="fact-net" as="dt" className="label">
                Netto-P&L
              </MorphTitle>
            </MorphCard>
            <button type="button">Anderer</button>
          </div>
        </MorphDialogProvider>
      </MotionRoot>,
    );
    const trigger = screen.getByRole("button", { name: /Netto-P&L/ });
    expect(trigger).toHaveAttribute("aria-haspopup", "dialog");
    expect(trigger.style.borderRadius).toBe("16px");
    fireEvent.click(trigger);
    const dialog = screen.getByRole("dialog");
    expect(dialog).toHaveAttribute("aria-modal", "true");
    expect(dialog.style.borderRadius).toBe("28px");
    expect(screen.getByText("Erklärung")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Schließen" })).toBeInTheDocument();
    expect(document.body.style.overflow).toBe("hidden");
    fireEvent.keyDown(document, { key: "Escape" });
    expect(document.body.style.overflow).toBe("");
  });

  it("Sheet renders header, body, footer and closes via the Schließen button", () => {
    const onClose = vi.fn();
    render(
      <MotionRoot>
        <Sheet open onClose={onClose} title="Trade eintragen" size="lg" footer={<span>Fuß</span>}>
          <p>Formular</p>
        </Sheet>
      </MotionRoot>,
    );
    const dialog = screen.getByRole("dialog", { name: "Trade eintragen" });
    expect(dialog.className).toContain("sm:max-w-[860px]");
    expect(dialog.style.borderRadius).toBe("28px");
    expect(screen.getByText("Formular")).toBeInTheDocument();
    expect(screen.getByText("Fuß")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Schließen" }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("StatusPill toggles between dot and labelled pill", () => {
    const { container, rerender } = render(<StatusPill tone="live" expanded={false} label="Live · alle 5 min" />);
    // no role="status" any more (not a live region); the root carries `data-status-pill`
    const pill = container.querySelector<HTMLElement>("[data-status-pill]") as HTMLElement;
    expect(pill.style.borderRadius).toBe("9999px");
    expect(screen.queryByText("Live · alle 5 min")).toBeNull();
    rerender(<StatusPill tone="warn" expanded label="Kein Live-Kurs" ring={0.5} spinning />);
    expect(screen.getByText("Kein Live-Kurs")).toBeInTheDocument();
    expect(pill.className).toContain("text-warn");
  });

  it("RollingDigits formats de-DE and keeps digit columns", () => {
    // accessible text = an sr-only span (a11y review: no aria-label on a generic element); separators are aria-hidden
    const { rerender } = render(<RollingDigits value={61234.5} decimals={1} className="dot-num" />);
    const el = screen.getByText("61.234,5").closest("[data-rolling-digits]") as HTMLElement;
    const visual = () => Array.from(el.querySelectorAll("[aria-hidden='true']")).map((e) => e.textContent).join("");
    expect(visual()).toContain(".");
    expect(visual()).toContain(",");
    rerender(<RollingDigits value={-61250} className="dot-num" />);
    expect(screen.getByText("−61.250")).toBeInTheDocument();
  });

  it("Sparkline resamples to 20 points and renders path + end dot", () => {
    expect(resample([1, 2, 3])).toHaveLength(20);
    expect(resample([5])).toHaveLength(20);
    const { container } = render(<Sparkline values={[1, 4, 2, 8, 5]} />);
    expect(container.querySelectorAll("path")).toHaveLength(2);
    const d = container.querySelectorAll("path")[1]?.getAttribute("d") ?? "";
    expect(d.split("L")).toHaveLength(20);
    expect(container.querySelector("circle")).toHaveAttribute("fill", "#e5202e");
  });

  it("ConvictionRadio exposes five radios, selects and clears", () => {
    function H() {
      const [v, setV] = useState<1 | 2 | 3 | 4 | 5 | null>(null);
      return <ConvictionRadio value={v} onChange={setV} />;
    }
    render(<H />);
    const group = screen.getByRole("radiogroup", { name: "Überzeugung" });
    const radios = screen.getAllByRole("radio");
    expect(radios).toHaveLength(5);
    expect(group).toBeInTheDocument();
    fireEvent.click(screen.getByRole("radio", { name: "Hoch" }));
    expect(screen.getByRole("radio", { name: "Hoch" })).toHaveAttribute("aria-checked", "true");
    fireEvent.click(screen.getByRole("radio", { name: "Hoch" }));
    expect(screen.getByRole("radio", { name: "Hoch" })).toHaveAttribute("aria-checked", "false");
  });

  it("Expander + Collapse, RingGauge, Badge, EmptyState, Field, SetupChips, WarnBanner, Skeleton, HeroBackdrop, SplitText, Label, Card", () => {
    function H() {
      const [open, setOpen] = useState(false);
      return (
        <>
          <Expander open={open} onToggle={() => setOpen((o) => !o)} label="Chart" controls="c" />
          <Collapse open={open} id="c">
            <p>Inhalt</p>
          </Collapse>
        </>
      );
    }
    render(
      <MotionRoot>
        <H />
        <RingGauge value={0.62} marker={0.5} aria-label="Win-Rate">
          <span className="dot-num text-[34px]">62 %</span>
        </RingGauge>
        <Badge tone="loss">Verlust</Badge>
        <EmptyState title="Noch keine Trades" text="Trage deinen ersten Trade ein." />
        <Field label="Hebel" htmlFor="lev" suffix="x" error="Pflichtfeld">
          <Input id="lev" numeric />
        </Field>
        <SetupChips items={[{ id: "a", name: "Breakout", color: "#fff" }, { id: "b", name: "Retest", color: "#aaa" }, { id: "c", name: "Range", color: "#999" }]} />
        <SetupChips items={[]} />
        <WarnBanner>Lokaler Modus</WarnBanner>
        <Skeleton height={40} />
        <div className="relative">
          <HeroBackdrop />
        </div>
        <SplitText text="Trade Journal" force />
        <Label>Übersicht</Label>
        <Card title="Kursverlauf" note="Binance · 4H">
          <p>Karte</p>
        </Card>
      </MotionRoot>,
    );
    const exp = screen.getByRole("button", { name: "Details zeigen: Chart" });
    expect(exp).toHaveAttribute("aria-expanded", "false");
    fireEvent.click(exp);
    expect(screen.getByRole("button", { name: "Details schließen: Chart" })).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByText("Inhalt")).toBeInTheDocument();
    expect(screen.getByRole("img", { name: "Win-Rate" })).toBeInTheDocument();
    expect(screen.getByText("Verlust").className).toContain("bg-loss/12 text-loss border-loss/25");
    expect(screen.getByText("Noch keine Trades")).toBeInTheDocument();
    expect(screen.getByRole("alert")).toHaveTextContent("Pflichtfeld");
    expect(screen.getByLabelText("Hebel")).toHaveAttribute("inputmode", "decimal");
    expect(screen.getByText("+1")).toBeInTheDocument();
    expect(screen.getByText("ohne Grundlage")).toBeInTheDocument();
    expect(screen.getByText("Lokaler Modus").closest("[role=status]")?.className).toContain("border-warn/30 bg-warn/[0.07]");
    expect(screen.getByText("Trade Journal")).toBeInTheDocument(); // SplitText: sr-only text, letters aria-hidden
    expect(screen.getByRole("heading", { level: 2, name: "Übersicht" }).className).toContain("label");
    expect(screen.getByRole("heading", { level: 2, name: "Kursverlauf" })).toBeInTheDocument();
    expect(screen.getByText("Binance · 4H").className).toContain("text-xs text-faint");
  });

  it("StatTile renders inside the provider and HoverPill follows the hover group", () => {
    function Rows() {
      const { hovered, bind } = useHoverGroup<string>();
      return (
        <div>
          {["a", "b"].map((id) => (
            <button key={id} type="button" className="relative" {...bind(id)}>
              <HoverPill show={hovered === id} group="recent" />
              Zeile {id}
            </button>
          ))}
        </div>
      );
    }
    // a hover-capable device: the active tile shows its verdict popover (touch shows the verdict in the dialog only)
    vi.stubGlobal("matchMedia", (q: string) => ({ matches: q === "(hover: hover)", media: q, onchange: null, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {}, dispatchEvent: () => false }));
    render(
      <MotionRoot>
        <MorphDialogProvider>
          <dl className="sm:flex">
            <StatTile fact="winRate" label="Win-Rate" value="62 %" active verdict={{ tone: "win", text: "Gut" }} body={() => <p>Body</p>} />
          </dl>
          <Rows />
        </MorphDialogProvider>
      </MotionRoot>,
    );
    vi.unstubAllGlobals();
    expect(screen.getByRole("button", { name: /Win-Rate/ })).toBeInTheDocument();
    expect(screen.getByText("Gut")).toBeInTheDocument();
    const a = screen.getByRole("button", { name: "Zeile a" });
    fireEvent.mouseEnter(a);
    expect(a.querySelector("span[aria-hidden]")?.className).toContain("bg-white/[0.055] ring-1 ring-white/[0.08]");
    // hovering the next row moves the pill there (the old one exits via AnimatePresence, .15 s + .15 s delay)
    const b = screen.getByRole("button", { name: "Zeile b" });
    fireEvent.mouseLeave(a);
    fireEvent.mouseEnter(b);
    expect(b.querySelector("span[aria-hidden]")?.className).toContain("bg-white/[0.055]");
  });

  it("StatTile on touch (no hover): an active tile never leaves its verdict popover open", () => {
    render(
      <MotionRoot>
        <MorphDialogProvider>
          <dl>
            <StatTile fact="winRate" label="Win-Rate" value="62 %" active verdict={{ tone: "win", text: "Gut" }} body={() => <p>Body</p>} />
          </dl>
        </MorphDialogProvider>
      </MotionRoot>,
    );
    expect(screen.getByRole("button", { name: /Win-Rate/ })).toBeInTheDocument();
    expect(screen.queryByText("Gut")).toBeNull();
  });

  it("PageSwitch reports transitioning and renders the active page", () => {
    const onT = vi.fn();
    const { rerender } = render(
      <MotionRoot>
        <PageSwitch index={0} pageKey="o" onTransitioning={onT}>
          <p>Übersicht</p>
        </PageSwitch>
      </MotionRoot>,
    );
    expect(screen.getByText("Übersicht")).toBeInTheDocument();
    act(() => {
      rerender(
        <MotionRoot>
          <PageSwitch index={1} pageKey="t" onTransitioning={onT}>
            <p>Trades</p>
          </PageSwitch>
        </MotionRoot>,
      );
    });
    expect(screen.getByText("Trades")).toBeInTheDocument();
    expect(onT).toHaveBeenCalledWith(true);
  });
});
