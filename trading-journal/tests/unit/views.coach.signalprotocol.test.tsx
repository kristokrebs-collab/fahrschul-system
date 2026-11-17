/**
 * Signalprotokoll in the Coach cards (F25/F28): the detail of an inbox entry shows the conditions that held when the signal was
 * raised (a word per line), the version of the rules it came from (and says when the settings changed since), and its history as
 * dated lines; the signal balance can be grouped by rule version.
 */
import { act, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { __resetDeliveryLog } from "@/market/keylevels/deliveryLog";
import { RULE_VERSIONS_KEY, __resetRuleVersions } from "@/market/ruleVersions";
import { __resetSignalArchive, recordSignalEvent, SIGNAL_ARCHIVE_KEY } from "@/market/signalArchive";
import { MotionRoot } from "@/motion/MotionRoot";
import { SignalBalanceCard } from "@/views/coach/SignalBalanceCard";
import { SignalInboxCard } from "@/views/coach/SignalInboxCard";
import { __resetAuto, __setAutoDeps } from "@/views/coach/signalAuto";
import { __resetOutcomes, OUTCOME_CACHE_KEY } from "@/views/coach/signalOutcomes";
import { stamp } from "@/views/coach/signalUi";
import { at, COACH_SETTINGS, ct, enrichC } from "./coach.fixtures";
import { H, signalInput } from "./missed.fixtures";
import { installDomPolyfills } from "./views.overview.harness";

const NOW = new Date(2026, 2, 8, 12).getTime();
vi.mock("@/views/labor/historySource", () => ({ loadLabData: vi.fn(async () => ({ data: {}, funding: null, pages: 0, viaProxy: false })), loadErrorKind: () => "failed" }));

const trades = enrichC([ct(at(0, 600), { id: "a", p: 100, pair: "BTC/USDT" })], COACH_SETTINGS);
const wrap = (node: React.ReactNode) => <MotionRoot>{node}</MotionRoot>;

beforeAll(() => {
  installDomPolyfills();
  window.matchMedia = ((q: string) => ({ matches: q.includes("reduced-motion"), media: q, onchange: null, addListener() {}, removeListener() {}, addEventListener() {}, removeEventListener() {}, dispatchEvent: () => false })) as unknown as typeof window.matchMedia;
});
beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(NOW);
  for (const k of [SIGNAL_ARCHIVE_KEY, OUTCOME_CACHE_KEY, RULE_VERSIONS_KEY, "tj2-signal-inbox-open"]) localStorage.removeItem(k);
  __resetSignalArchive();
  __resetDeliveryLog();
  __resetOutcomes();
  __resetRuleVersions();
  __setAutoDeps({
    later: (cb) => {
      const t = setTimeout(cb, 0);
      return () => clearTimeout(t);
    },
  });
});
afterEach(() => {
  __resetAuto();
  vi.useRealTimers();
});

describe("the detail of an inbox entry", () => {
  it("shows the conditions with a word each, the rule version, and the history in time order", async () => {
    const t0 = NOW - 3 * H;
    recordSignalEvent(
      signalInput({
        key: "k|L1|0|confirm",
        source: "key",
        kind: "confirm",
        ref: "L1",
        at: t0,
        label: "Bestätigt · L1",
        prereq: [
          { id: "rule", label: "2 4h-Schlüsse in Folge über der Marke", met: true },
          { id: "basis", label: "Auf dem Kerzenschluss bestätigt (nicht nur im Lauf)", met: false },
          { id: "x", label: "Ein Teil ohne Daten", met: null },
        ],
        rules: { kind: "key", hash: "abcdef01", n: 2, since: t0 - 5 * H },
      }),
    );
    recordSignalEvent(signalInput({ key: "k|L1|0|retest", source: "key", kind: "retest", ref: "L1", at: t0 + H, label: "Retest · L1" }));
    render(wrap(<SignalInboxCard list={trades} now={NOW} />));
    const confirm = screen.getAllByTestId("inbox-row").find((r) => r.textContent?.includes("Bestätigt · L1"))!;
    await act(async () => {
      fireEvent.click(within(confirm).getByTestId("inbox-view"));
    });
    const detail = within(screen.getAllByTestId("inbox-detail")[0]!);
    const rows = detail.getAllByRole("listitem").filter((li) => li.hasAttribute("data-met"));
    expect(rows.map((li) => [li.getAttribute("data-met"), li.textContent])).toEqual([
      ["true", "✓ erfüllt2 4h-Schlüsse in Folge über der Marke"],
      ["false", "✗ nicht erfülltAuf dem Kerzenschluss bestätigt (nicht nur im Lauf)"],
      ["null", "? keine DatenEin Teil ohne Daten"],
    ]);
    expect(detail.getByTestId("detail-rules-label")).toHaveTextContent(`Schlüsselmarke · Regelstand 2 (abcdef01) · zuerst gesehen ${stamp(t0 - 5 * H)}`);
    // the history: raised (-3 h) → seen (when it was opened) → the retest of the same level (-2 h) → the window end
    const kinds = detail.getAllByRole("listitem").filter((li) => li.hasAttribute("data-kind")).map((li) => li.getAttribute("data-kind"));
    expect(kinds).toEqual(["raised", "stage", "seen", "window"]);
    const stage = detail.getAllByRole("listitem").find((li) => li.getAttribute("data-kind") === "stage")!;
    expect(stage).toHaveTextContent("Schlüsselmarke · Retest: Retest · L1");
    expect(stage).toHaveTextContent("dieselbe Marke / Box");
    expect(stage).toHaveAttribute("data-sibling", "true");
  });

  it("an entry without stored conditions or version says so instead of inventing them", async () => {
    recordSignalEvent(signalInput({ key: "old", at: NOW - H, label: "Alt" }));
    render(wrap(<SignalInboxCard list={trades} now={NOW} />));
    await act(async () => {
      fireEvent.click(screen.getByTestId("inbox-view"));
    });
    expect(screen.getByTestId("detail-prereq-none")).toHaveTextContent("keine Voraussetzungen gespeichert");
    expect(screen.getByTestId("detail-rules-none")).toHaveTextContent("Kein Regelstand gespeichert");
  });

  it("when the settings changed since, the detail says which version is current – nothing about what changed", async () => {
    const t0 = NOW - 3 * H;
    localStorage.setItem(
      RULE_VERSIONS_KEY,
      JSON.stringify({
        v: 1,
        items: [
          { kind: "entry", scope: "", hash: "aaaaaaaa", n: 1, since: t0 - H },
          { kind: "entry", scope: "", hash: "bbbbbbbb", n: 2, since: t0 + H },
        ],
      }),
    );
    recordSignalEvent(signalInput({ key: "e", at: t0, rules: { kind: "entry", hash: "aaaaaaaa", n: 1, since: t0 - H } }));
    render(wrap(<SignalInboxCard list={trades} now={NOW} />));
    await act(async () => {
      fireEvent.click(screen.getByTestId("inbox-view"));
    });
    expect(screen.getByTestId("detail-rules-changed")).toHaveTextContent(`aktuell Regelstand 2 (bbbbbbbb) seit ${stamp(t0 + H)}`);
  });

  it("your own marks appear in the history with their time", async () => {
    recordSignalEvent(signalInput({ key: "m", at: NOW - 2 * H }));
    render(wrap(<SignalInboxCard list={trades} now={NOW} />));
    await act(async () => {
      fireEvent.click(screen.getByTestId("inbox-view"));
    });
    await act(async () => {
      fireEvent.click(screen.getByTestId("inbox-skip"));
    });
    await act(async () => {
      fireEvent.click(screen.getByTestId("inbox-skip-time"));
    });
    await act(async () => {
      fireEvent.click(screen.getByTestId("inbox-view"));
    });
    const hist = screen.getByTestId("detail-history");
    expect(hist).toHaveTextContent("Bewusst ausgelassen – Keine Zeit");
    expect(hist).toHaveTextContent("Angesehen");
  });
});

describe("the balance by rule version", () => {
  it("offers 'Regelstand' as a grouping and sorts the signals into the versions", () => {
    const base = { rules: { kind: "entry" as const, hash: "aaaaaaaa", n: 1, since: 0 } };
    recordSignalEvent(signalInput({ key: "a", at: NOW - 5 * H, ...base }));
    recordSignalEvent(signalInput({ key: "b", at: NOW - 4 * H, ...base }));
    recordSignalEvent(signalInput({ key: "c", at: NOW - 3 * H, rules: { kind: "entry", hash: "bbbbbbbb", n: 2, since: 1 } }));
    render(wrap(<SignalBalanceCard list={trades} now={NOW} />));
    fireEvent.click(screen.getByTestId("balance-by-rules"));
    const rows = screen.getAllByTestId("balance-row").filter((r) => r.getAttribute("data-key") !== "alle");
    expect(rows.map((r) => [r.getAttribute("data-key"), r.getAttribute("data-n")])).toEqual([
      ["entry|aaaaaaaa", "2"],
      ["entry|bbbbbbbb", "1"],
    ]);
    expect(rows[0]).toHaveTextContent("Einstiegs-Check · Regelstand 1 (aaaaaaaa)");
  });
});
