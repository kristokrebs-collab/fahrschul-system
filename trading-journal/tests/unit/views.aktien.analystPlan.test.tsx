/**
 * The analyst section of the page Aktien hands the ticker to the Handelsplan: "Plan erstellen →" next to "These anlegen" opens
 * `#plan?symbol=<ticker>&side=long` – nothing else happens (the Handelsplan reads market and direction, saves and sends nothing).
 * The three panels themselves are stubbed here; the real ones are tested in `views.analyst.test.tsx`.
 */
import { fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { AktienSlotProps } from "@/views/aktien/types";

vi.mock("@/views/analyst/AnalystPanel", () => ({
  default: (p: { ticker?: string; onCreatePlan?: (t: string) => void }) => (
    <div data-testid="analyst-stub" data-ticker={p.ticker}>
      {p.onCreatePlan ? (
        <button type="button" data-testid="analyst-create-plan" onClick={() => p.onCreatePlan?.("BRK-B")}>
          Plan erstellen →
        </button>
      ) : null}
    </div>
  ),
}));
vi.mock("@/views/analyst/DcfPanel", () => ({ default: () => <div data-testid="dcf-stub" /> }));
vi.mock("@/views/analyst/ThesisPanel", () => ({ default: () => <div data-testid="thesis-stub" /> }));

const { AnalystSlotImpl } = await import("@/views/aktien/slotsImpl");

const props: AktienSlotProps = { watchlist: [], symbol: "AAPL", data: {} as AktienSlotProps["data"] };

afterEach(() => history.replaceState(null, "", "#aktien"));

describe("Aktien › Analyse › Plan erstellen", () => {
  it("der Knopf des Analysten öffnet den Handelsplan für den Ticker (Long vorbelegt, nichts gespeichert)", async () => {
    render(<AnalystSlotImpl {...props} />);
    expect(await screen.findByTestId("analyst-stub")).toHaveAttribute("data-ticker", "AAPL");
    fireEvent.click(screen.getByTestId("analyst-create-plan"));
    expect(window.location.hash).toBe("#plan?symbol=BRK-B&side=long");
  });
});
