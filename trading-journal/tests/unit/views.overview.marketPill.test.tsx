/**
 * Market card pill and footer while the stream is down (Galaxy Tab, 2026-10-08): the card says how the shown price
 * arrives — `Live`, `Kurs per Abfrage · 5 s`, `Verbinde …`, `Kein Live-Kurs` only when nothing delivered for 2 min —
 * and the footer names the time of the price actually shown.
 */
import { render, screen } from "@testing-library/react";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { bootFixtureJournal, installDomPolyfills, type FakeMarket } from "./views.overview.harness";
import type { MarketView } from "@/market";

const fake = vi.hoisted(() => ({ current: null as FakeMarket | null, view: null as null | ((v: MarketView) => MarketView) }));

vi.mock("@/market", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/market")>();
  const { fakeMarket } = await import("./views.overview.harness");
  fake.current = fakeMarket(actual);
  return { ...actual, ...fake.current.overrides };
});
// the card derives its view in `useMarketPanelView`: the real hook runs, the test swaps the price status of its result
vi.mock("@/views/overview/useMarket", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/views/overview/useMarket")>();
  return {
    ...actual,
    useMarketPanelView: (...args: Parameters<typeof actual.useMarketPanelView>) => {
      const v = actual.useMarketPanelView(...args);
      return fake.view ? { ...v, ...fake.view(v) } : v;
    },
  };
});
vi.mock("@/app/overlays", () => ({
  TradeDetail: () => null,
  TradeEditor: () => null,
  SetupEditor: () => null,
  HyblockForm: () => null,
}));

import { MotionRoot } from "@/motion/MotionRoot";
import { MorphDialogProvider } from "@/motion/MorphDialog";
import { MarketPanel } from "@/views/overview";

function wrap() {
  return render(
    <MotionRoot>
      <MorphDialogProvider>
        <MarketPanel />
      </MorphDialogProvider>
    </MotionRoot>,
  );
}
const pillText = () => [...document.querySelectorAll("[data-status-pill]")].map((p) => p.textContent ?? "").join(" | ");

describe("MarketPanel price status", () => {
  beforeAll(() => installDomPolyfills());
  beforeEach(async () => {
    await bootFixtureJournal();
  });
  afterEach(() => {
    fake.view = null;
  });

  it("stream: the LivePill", () => {
    wrap();
    expect(pillText()).toContain("Live");
    expect(screen.queryByText(/Kurs per Abfrage/)).toBeNull();
  });

  it("socket down, REST stands in: `Kurs per Abfrage · 5 s` over the price, no `Kein Live-Kurs`, no `veraltet` footer", () => {
    fake.view = (v) => ({ ...v, status: "live", priceMode: "poll", pill: { tone: "warn", text: "Kurs per Abfrage · 5 s", detail: "WebSocket getrennt, REST-Abfrage" } });
    wrap();
    expect(pillText()).toContain("Kurs per Abfrage · 5 s");
    expect(pillText()).not.toContain("Kein Live-Kurs");
    expect(screen.getByText("86.100")).toBeInTheDocument();
    expect(screen.queryByText(/veraltet/)).toBeNull();
  });

  it("stand-in failing: `Verbinde …`", () => {
    fake.view = (v) => ({ ...v, status: "live", priceMode: "waiting", pill: { tone: "muted", text: "Verbinde …", detail: "Netzwerk/CORS-Fehler" } });
    wrap();
    expect(pillText()).toContain("Verbinde …");
  });

  it("nothing for 2 min: `Kein Live-Kurs` and the footer `Zuletzt HH:mm · veraltet` of the shown price", () => {
    fake.view = (v) => ({ ...v, status: "error", message: "Zuletzt 15:31 · veraltet", priceMode: "none", pill: { tone: "error", text: "Kein Live-Kurs", detail: "Zuletzt 15:31 · veraltet" } });
    wrap();
    expect(pillText()).toContain("Kein Live-Kurs");
    expect(screen.getByText("Zuletzt 15:31 · veraltet")).toBeInTheDocument();
  });
});
