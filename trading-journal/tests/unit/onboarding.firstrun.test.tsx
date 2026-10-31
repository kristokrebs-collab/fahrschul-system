/**
 * Etappe 1a: the first-run modal is gone; an empty first visit shows ONE empty state with ONE action. Whoever saw the former
 * modal (a stored `done` / `skipped`) or has trades (`seen`) never sees it.
 */
import { act, fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";
import { MotionRoot } from "@/motion/MotionRoot";
import { FIRST_RUN, FirstRunEmpty, firstRunVisible } from "@/onboarding/FirstRunEmpty";
import { ONBOARDING_KEY, readOnboarding } from "@/onboarding/onboardingStore";
import { OnboardingHost } from "@/onboarding/OnboardingHost";
import { useJournal } from "@/store/journalStore";
import { useUi } from "@/store/uiStore";
import { bootFixtureJournal, installDomPolyfills } from "./views.overview.harness";

const base = { loaded: true, tradeCount: 0, stored: false, page: "overview", sharing: false, dismissed: false };

describe("firstRunVisible (pure)", () => {
  it("only for an empty, loaded journal on a first visit, on the start page or the trades", () => {
    expect(firstRunVisible(base)).toBe(true);
    expect(firstRunVisible({ ...base, page: "trades" })).toBe(true);
    expect(firstRunVisible({ ...base, page: "markt" })).toBe(false);
    expect(firstRunVisible({ ...base, loaded: false })).toBe(false);
    expect(firstRunVisible({ ...base, tradeCount: 1 })).toBe(false);
    // the former modal was seen (done / skipped) or the trader has trades (seen): never again
    expect(firstRunVisible({ ...base, stored: true })).toBe(false);
    expect(firstRunVisible({ ...base, sharing: true })).toBe(false);
    expect(firstRunVisible({ ...base, dismissed: true })).toBe(false);
  });
});

describe("FirstRunEmpty", () => {
  beforeEach(async () => {
    installDomPolyfills();
    await bootFixtureJournal();
    localStorage.removeItem(ONBOARDING_KEY);
    useUi.setState({ page: "overview", editor: { open: false, fromFab: false } });
    await act(async () => {
      useJournal.setState({ trades: [] });
    });
  });

  it("shows one button; it remembers the visit and opens the editor", async () => {
    render(
      <MotionRoot>
        <FirstRunEmpty />
      </MotionRoot>,
    );
    const box = screen.getByTestId("first-run-empty");
    expect(box).toHaveTextContent(FIRST_RUN.title);
    expect(box.querySelectorAll("button")).toHaveLength(1);
    fireEvent.click(screen.getByRole("button", { name: FIRST_RUN.action }));
    expect(useUi.getState().editor.open).toBe(true);
    expect(readOnboarding()?.status).toBe("seen");
  });

  it("never shows after the former modal was seen", () => {
    localStorage.setItem(ONBOARDING_KEY, JSON.stringify({ status: "skipped", at: "", v: 1 }));
    render(
      <MotionRoot>
        <FirstRunEmpty />
      </MotionRoot>,
    );
    expect(screen.queryByTestId("first-run-empty")).toBeNull();
  });

  it("the host no longer opens a modal by itself on an empty journal; a first trade marks the trader as seen", async () => {
    render(
      <MotionRoot>
        <OnboardingHost />
      </MotionRoot>,
    );
    await new Promise((r) => setTimeout(r, 40));
    expect(screen.queryByRole("dialog", { name: "Einführung" })).toBeNull();
    expect(readOnboarding()).toBeNull();
    await act(async () => {
      useJournal.setState({ trades: bootTrades });
    });
    expect(readOnboarding()?.status).toBe("seen");
  });
});

// a journal with trades, taken from the fixture before the tests emptied it
let bootTrades: ReturnType<typeof useJournal.getState>["trades"] = [];
beforeEach(async () => {
  await bootFixtureJournal();
  bootTrades = useJournal.getState().trades;
});
