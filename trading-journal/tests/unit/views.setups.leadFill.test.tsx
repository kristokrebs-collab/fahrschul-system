import { render } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";
import { LeadFill } from "@/views/setups/LeadFill";

describe("LeadFill (page subtitle recipe)", () => {
  beforeEach(() => sessionStorage.clear());

  it("plays the pixel fill once per session and marks the session", () => {
    const { container } = render(<LeadFill text="Jede Karte zeigt, wie oft die Grundlage funktioniert hat." storageKey="tj2-fill-test" highlight="funktioniert" />);
    expect(container.querySelector('[data-pulse="pixel-text-fill"]')).not.toBeNull();
    expect(sessionStorage.getItem("tj2-fill-test")).toBe("1");
    // the real text stays readable (once, not aria-hidden)
    const base = container.querySelector("[data-ptf-base]")!;
    expect(base.textContent).toBe("Jede Karte zeigt, wie oft die Grundlage funktioniert hat.");
    expect(base.closest('[aria-hidden="true"]')).toBeNull();
  });

  it("already seen: plain paragraph with the static marker on the key word, identical text", () => {
    sessionStorage.setItem("tj2-fill-test", "1");
    const { container } = render(<LeadFill text="Startkapital und Trigger-Level." storageKey="tj2-fill-test" highlight="Startkapital" />);
    expect(container.querySelector('[data-pulse="pixel-text-fill"]')).toBeNull();
    const p = container.querySelector("p")!;
    // accessible text = the lead once (the marker's coloured copy is aria-hidden)
    const visible = [...p.querySelectorAll('[aria-hidden="true"]')].reduce((t, el) => t.replace(el.textContent ?? "", ""), p.textContent ?? "");
    expect(visible).toBe("Startkapital und Trigger-Level.");
    const marker = container.querySelector('[data-pulse="tactile-highlight"]') as HTMLElement;
    expect(marker).not.toBeNull();
    expect(marker.dataset.tone).toBe("invert");
    // no side padding: the word keeps its advance (no reflow at the hand-off) and the bar never covers a neighbour
    expect(marker.className).toContain("px-0!");
  });

  it("without a matching key word it renders the plain lead", () => {
    sessionStorage.setItem("tj2-fill-test", "1");
    const { container } = render(<LeadFill text="Nur Text." storageKey="tj2-fill-test" highlight="fehlt" />);
    expect(container.querySelector('[data-pulse="tactile-highlight"]')).toBeNull();
    expect(container.textContent).toBe("Nur Text.");
  });
});
