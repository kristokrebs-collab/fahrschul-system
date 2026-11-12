import { beforeEach, describe, expect, it } from "vitest";
import {
  autoStartDecision,
  finishOnboarding,
  markSeen,
  ONBOARDING_KEY,
  pauseOnboarding,
  readOnboarding,
  resumeOnboarding,
  skipOnboarding,
  startOnboarding,
  useOnboarding,
} from "@/onboarding/onboardingStore";
import { onboardingStatusText } from "@/onboarding/OnboardingCard";
import { GOAL_TEMPLATES, parseAmount } from "@/onboarding/steps";
import { sanitizeGoalDraft } from "@/domain/growth/goals";

describe("onboarding store", () => {
  beforeEach(() => {
    localStorage.removeItem(ONBOARDING_KEY);
    useOnboarding.setState({ open: false, step: 0, source: "manual", paused: false, loaded: false });
  });

  it("auto-start: only a genuinely first run with an empty, loaded journal after the intro", () => {
    const base = { stored: null, loaded: true, tradeCount: 0, introSettled: true, busy: false };
    expect(autoStartDecision(base)).toBe("start");
    expect(autoStartDecision({ ...base, loaded: false })).toBe("wait");
    expect(autoStartDecision({ ...base, introSettled: false })).toBe("wait");
    expect(autoStartDecision({ ...base, busy: true })).toBe("wait");
    expect(autoStartDecision({ ...base, tradeCount: 3 })).toBe("seen");
    expect(autoStartDecision({ ...base, stored: { status: "skipped", at: "", v: 1 } })).toBe("never");
    // an existing trader is never interrupted, even before the intro settled
    expect(autoStartDecision({ ...base, tradeCount: 1, introSettled: false })).toBe("seen");
  });

  it("finish / skip / seen are remembered; a skipped re-run keeps an earlier done", () => {
    expect(readOnboarding()).toBeNull();
    startOnboarding();
    expect(useOnboarding.getState()).toMatchObject({ open: true, step: 0, loaded: true });
    finishOnboarding();
    expect(readOnboarding()!.status).toBe("done");
    expect(useOnboarding.getState().open).toBe(false);
    startOnboarding();
    skipOnboarding();
    expect(readOnboarding()!.status).toBe("done");
    localStorage.removeItem(ONBOARDING_KEY);
    skipOnboarding();
    expect(readOnboarding()!.status).toBe("skipped");
    localStorage.removeItem(ONBOARDING_KEY);
    markSeen();
    expect(readOnboarding()!.status).toBe("seen");
    markSeen();
    localStorage.setItem(ONBOARDING_KEY, "{broken");
    expect(readOnboarding()).toBeNull();
  });

  it("pause keeps the step, resume brings the tour back", () => {
    startOnboarding();
    useOnboarding.setState({ step: 2 });
    pauseOnboarding();
    expect(useOnboarding.getState()).toMatchObject({ open: false, paused: true, step: 2 });
    resumeOnboarding();
    expect(useOnboarding.getState()).toMatchObject({ open: true, paused: false, step: 2 });
  });

  it("status line of the settings card", () => {
    expect(onboardingStatusText(null)).toBe("Noch nicht angesehen.");
    expect(onboardingStatusText({ status: "skipped", at: "", v: 1 })).toMatch(/Übersprungen/);
    expect(onboardingStatusText({ status: "done", at: "2026-10-12T10:00:00.000Z", v: 1 })).toBe("Abgeschlossen am 12.10.2026.");
  });

  it("parses German and plain amounts, rejects junk and negatives", () => {
    expect(parseAmount("25.000")).toBe(25000);
    expect(parseAmount("25.000,50")).toBe(25000.5);
    expect(parseAmount("2500.5")).toBe(2500.5);
    expect(parseAmount(" 1 000 ")).toBe(1000);
    expect(parseAmount("")).toBe(0);
    expect(parseAmount("-5")).toBeNull();
    expect(parseAmount("abc")).toBeNull();
  });

  it("every goal template is a valid process / limit goal for P08", () => {
    for (const t of GOAL_TEMPLATES) {
      const clean = sanitizeGoalDraft(t.draft);
      expect(clean, t.id).not.toBeNull();
      expect(clean!.source.kind).toBe("onboarding");
      expect(["process", "limit"]).toContain(clean!.kind);
    }
  });
});
