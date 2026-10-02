import { describe, expect, it } from "vitest";
import { monotoneCubic, ORBIT_KEYS, ORBIT_MS, orbitCurve, ROLL_KEYS, rollCurve, ZOOM_KEYS, zoomCurve } from "@/intro/curves";
import { BEATS, reelState } from "@/intro/director";
import { deckPoses, flightDuration, flightProgress, flightTransform, appPose } from "@/intro/flight";
import { canAutoplay, canReplay, pageOfHash, readIntroEnv, type IntroEnv } from "@/intro/introBoot";
import { CONFIG } from "@/intro/introConfig";
import { introDataLine } from "@/intro/IntroStage";
import { portalCamera, portalEndScale } from "@/intro/portal";

const env = (over: Partial<IntroEnv> = {}): IntroEnv => ({ seen: false, reduced: false, pref: null, browser: true, page: "overview", ...over });

describe("intro play conditions", () => {
  it("autoplays once per session, with motion, not switched off, in a real browser, on the overview", () => {
    expect(canAutoplay(env())).toBe(true);
    expect(canAutoplay(env({ seen: true }))).toBe(false);
    expect(canAutoplay(env({ reduced: true }))).toBe(false);
    expect(canAutoplay(env({ pref: "off" }))).toBe(false);
    expect(canAutoplay(env({ pref: "on" }))).toBe(true);
    expect(canAutoplay(env({ browser: false }))).toBe(false);
    expect(canAutoplay(env({ page: "trades" }))).toBe(false);
  });

  it("replay ignores the session flag and the start switch, but never runs under reduced motion or jsdom", () => {
    expect(canReplay({ browser: true, reduced: false })).toBe(true);
    expect(canReplay({ browser: true, reduced: true })).toBe(false);
    expect(canReplay({ browser: false, reduced: false })).toBe(false);
  });

  it("start page from the hash", () => {
    expect(pageOfHash("")).toBe("overview");
    expect(pageOfHash("#overview")).toBe("overview");
    expect(pageOfHash("#nope")).toBe("overview");
    expect(pageOfHash("#trades?setup=x")).toBe("trades");
    expect(pageOfHash("#settings")).toBe("settings");
  });

  it("jsdom is never a real browser", () => {
    expect(readIntroEnv().browser).toBe(false);
    expect(canAutoplay(readIntroEnv())).toBe(false);
  });
});

describe("measured curves", () => {
  it("pass through every key and stay monotone", () => {
    for (const [keys, f] of [
      [ZOOM_KEYS, zoomCurve],
      [ROLL_KEYS, rollCurve],
      [ORBIT_KEYS, orbitCurve],
    ] as const) {
      for (const [x, y] of keys) expect(f(x)).toBeCloseTo(y, 9);
      const last = keys[keys.length - 1]![0];
      let prev = -Infinity;
      for (let i = 0; i <= 400; i++) {
        const v = f((last * i) / 400);
        expect(v).toBeGreaterThanOrEqual(prev - 1e-12);
        prev = v;
      }
    }
    expect(orbitCurve(ORBIT_MS + 50)).toBe(1);
    expect(monotoneCubic([[0, 0], [1, 1]])(-1)).toBe(0);
  });
});

describe("build beat (deck → slots)", () => {
  const rects = [
    { x: 24, y: 80, w: 1272, h: 600 },
    { x: 24, y: 700, w: 1272, h: 500 },
  ];

  it("poses the cards as a slanted compact deck centred on the viewport", () => {
    const [a, b] = deckPoses(rects, 1440, 900);
    const u = 1440 / 1234;
    // centres land at the viewport centre ± half a compact step
    expect(rects[0]!.x + rects[0]!.w / 2 + a!.dx).toBeCloseTo(720 - (CONFIG.deck.stepX * u) / 2, 6);
    expect(rects[1]!.y + rects[1]!.h / 2 + b!.dy).toBeCloseTo(450 + (CONFIG.deck.stepY * u) / 2, 6);
    expect(a!.scale).toBeLessThanOrEqual(CONFIG.deck.scale);
    expect(a!.rot).toBe(CONFIG.deck.rot);
    // a tall card is scaled down until it fits the viewport
    const [tall] = deckPoses([{ x: 16, y: 80, w: 358, h: 1500 }], 390, 844);
    expect(tall!.scale * 1500).toBeLessThanOrEqual(CONFIG.deck.fitH * 844 + 1e-9);
  });

  it("travels on the orbit curve, staggered, and ends at transform none", () => {
    const pose = deckPoses(rects, 1440, 900)[0]!;
    expect(flightTransform(pose, 1)).toBe("none");
    expect(flightTransform(pose, 0)).toContain(`rotate(${pose.rot.toFixed(3)}deg)`);
    expect(flightProgress(0, 0)).toBe(0);
    expect(flightProgress(CONFIG.flight.stagger, 1)).toBe(0);
    expect(flightProgress(ORBIT_MS / CONFIG.flight.speed, 0)).toBe(1);
    expect(flightProgress(flightDuration(3), 2)).toBe(1);
    expect(flightProgress(700 / CONFIG.flight.speed, 0)).toBeCloseTo(0.04, 6);
  });

  it("app zoom-out ends exactly at identity", () => {
    expect(appPose(0).scale).toBe(CONFIG.app.scaleFrom);
    expect(appPose(1)).toEqual({ scale: 1, blur: 0 });
  });
});

describe("reels and portal", () => {
  it("window opens, hard-cuts through the reels at the measured starts, collapses", () => {
    expect(reelState(0).reel).toBe(-1);
    expect(reelState(CONFIG.reels.startAt + 100).reel).toBe(1);
    expect(reelState(CONFIG.reels.startAt + 840).reel).toBe(6);
    expect(reelState(CONFIG.reels.startAt + 300).scale).toBe(1);
    expect(reelState(BEATS.collapse + CONFIG.reels.collapseDur).reel).toBe(-1);
    expect(BEATS.portal).toBeGreaterThan(BEATS.collapse);
  });

  it("the dive scales until the counter covers the farthest corner", () => {
    const end = portalEndScale(20, 720, 450, 1440, 900);
    expect(20 * end).toBeGreaterThanOrEqual(Math.hypot(720, 450));
    expect(portalCamera(0, end).scale).toBe(1);
    expect(Math.abs(portalCamera(0, end).rot)).toBe(0);
    expect(portalCamera(1, end).scale).toBeCloseTo(end, 6);
    expect(portalCamera(1, end).rot).toBe(CONFIG.portal.roll);
  });

  it("types the real data line", () => {
    expect(introDataLine(13, 4, "BTCUSDT", 86_100.4)).toBe("13 Trades · 4 Grundlagen · BTCUSDT 86.100");
    expect(introDataLine(1, 1, "BTCUSDT", 0)).toBe("1 Trade · 1 Grundlage · BTCUSDT");
  });
});
