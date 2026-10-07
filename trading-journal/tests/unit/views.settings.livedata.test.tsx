/**
 * Live-Daten card: per ratio feed the real source, the time of the newest point, the next poll — and while a feed
 * fails, the cause, how often in a row and when it is retried; above the table whether Binance is reachable or
 * blocked and whether the EU proxy is there.
 */
import { render, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { buildFeedSpecs } from "@/market/feeds";
import { initialHealth, reduceHealth } from "@/market/health";
import type { HealthEvent, ProviderHealth } from "@/market/types";
import { FEED_LABELS, LiveDataCard, feedDetailLine, routeLine } from "@/views/settings/LiveDataCard";

const specs = buildFeedSpecs("1h");
/** 12:05 UTC */
const T = Date.UTC(2026, 9, 7, 12, 5);
const run = (events: HealthEvent[], h: ProviderHealth = initialHealth(specs)) => events.reduce((a, ev) => reduceHealth(a, ev, specs), h);
const hm = (ms: number) => new Intl.DateTimeFormat("de-DE", { hour: "2-digit", minute: "2-digit" }).format(new Date(ms));

describe("LiveDataCard · ratio feeds", () => {
  const base = run([
    { type: "ws_message", feeds: ["aggTrade", "markPrice"], asOf: T, now: T },
    { type: "rest_ok", feed: "topAccountRatio5m", source: "binance", asOf: T, now: T + 50_000 },
    { type: "schedule", feed: "topAccountRatio5m", nextRefreshAt: T + 382_000 },
    { type: "rest_ok", feed: "topAccountRatio", source: "binance", asOf: T - 5 * 60_000, now: T + 50_000 },
    { type: "rest_fail", feed: "globalAccountRatio5m", source: "binance", kind: "network", now: T + 60_000, detail: "Netzwerk/CORS: Failed to fetch" },
    { type: "rest_fail", feed: "globalAccountRatio5m", source: "binance", kind: "network", now: T + 75_000, detail: "Netzwerk/CORS: Failed to fetch" },
    { type: "schedule", feed: "globalAccountRatio5m", nextRefreshAt: T + 105_000 },
  ]);

  it("labels the 5-min twins and lists every feed", () => {
    expect(FEED_LABELS.topAccountRatio5m).toBe("Top-Trader Konten · 5 min");
    render(<LiveDataCard health={base} />);
    for (const label of ["Top-Trader Konten · 5 min", "Top-Trader Positionen · 5 min", "Alle Konten · 5 min", "Top-Trader Konten"]) {
      expect(screen.getAllByText(label, { exact: false }).length).toBeGreaterThan(0);
    }
  });

  it("a healthy ratio feed shows its newest point and the next poll; a failing one the cause, count and retry", () => {
    expect(feedDetailLine(base.feeds.topAccountRatio5m)).toBe(`Punkt ${hm(T)} · nächste Abfrage ${hm(T + 382_000)}`);
    expect(feedDetailLine(base.feeds.globalAccountRatio5m)).toBe(`Netzwerk/CORS-Fehler (Netzwerk/CORS: Failed to fetch) · 2× in Folge · neuer Versuch ${hm(T + 105_000)}`);
    expect(feedDetailLine(base.feeds.markPrice)).toBeNull(); // WS feeds without failure: no extra line
    render(<LiveDataCard health={base} />);
    const lines = screen.getAllByText((_, el) => el?.hasAttribute("data-feed-detail") ?? false);
    const failing = lines.find((l) => l.textContent?.startsWith("Netzwerk/CORS-Fehler"))!;
    expect(failing.className).toContain("text-warn");
    const row = failing.closest("tr")!;
    expect(within(row).getByText("Binance")).toBeInTheDocument(); // still on Binance, not Bybit
  });

  it("route line: Binance reachable / blocked with the next re-probe; proxy ready or not", () => {
    expect(routeLine(base)).toEqual(["Binance erreichbar"]);
    const blocked = run([
      { type: "probe", source: "binance", ok: false, blocked: true, now: T },
      { type: "probe_scheduled", at: T + 300_000, now: T },
      { type: "probe", source: "proxy", ok: false, now: T },
    ]);
    expect(routeLine(blocked)).toEqual([`Binance blockiert (Region) · neuer Versuch ${hm(T + 300_000)}`, "EU-Proxy nicht erreichbar"]);
    const viaProxy = run([{ type: "probe", source: "proxy", ok: true, now: T }], base);
    expect(routeLine(viaProxy)).toEqual(["Binance erreichbar", "EU-Proxy bereit"]);
    render(<LiveDataCard health={blocked} />);
    expect(screen.getByText(/^Binance blockiert \(Region\)/)).toHaveClass("text-warn");
  });

  it("tolerates a partial health snapshot (no ratio rows, no primary)", () => {
    const partial = {
      overall: "live",
      online: true,
      ws: { attempt: 0 },
      proxy: { usable: true },
      feeds: { markPrice: { feed: "markPrice", source: "binance", state: "live", lastDataAt: T } },
    } as unknown as ProviderHealth;
    render(<LiveDataCard health={partial} />);
    expect(screen.getByText("Mark-Preis")).toBeInTheDocument();
    expect(screen.getByText("EU-Proxy bereit")).toBeInTheDocument();
  });
});
