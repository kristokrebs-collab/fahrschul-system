/**
 * F42 in the interface: the CSV sheet and the sync card say what they read and what they do not (Spot, Coin-M, Hedge-
 * Modus) – and a file with hedge-mode legs shows the warning in the preview instead of a silently wrong position.
 */
import { act, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { setCloudEnabledForTests } from "@/cloud/env";
import { resetCloudSession, useCloudSession } from "@/cloud/session";
import { CsvImportSheet } from "@/exchanges/csv/CsvImportSheet";
import { SCOPE_TEXT } from "@/exchanges/csv/scope";
import { openCsvImport, resetExchangeStore } from "@/exchanges/store";
import type { ExchangeConnection, ExchangeStatus } from "@/exchanges/types";
import { ExchangeConnectionsCard } from "@/exchanges/ui/ExchangeConnectionsCard";
import { MotionRoot } from "@/motion/MotionRoot";
import { useJournal } from "@/store/journalStore";
import { settings } from "./domain.fixtures";

const USER = { id: "11111111-1111-4111-8111-111111111111", email: "t@example.com", aal: "aal1" as const, mfaEnrolled: false };
const CONN: ExchangeConnection = {
  id: "c0ffee00-0000-4000-8000-000000000001",
  exchange: "bitunix",
  label: "Hauptkonto",
  keyLast4: "7e2d",
  permissions: ["read"],
  status: "active",
  lastSyncAt: null,
  lastError: null,
  journalAccount: "scalp",
  syncEnabled: true,
  createdAt: "2026-10-12T08:00:00.000Z",
};
const status = (p: Partial<ExchangeStatus> = {}): ExchangeStatus => ({
  configured: true,
  cron: { enabled: true, everyMin: 30, nextAt: "2026-10-12T09:30:00.000Z" },
  plan: { plan: "pro", entitled: true, limit: 1, gated: false },
  connections: [],
  runs: [],
  ...p,
});

let server: ExchangeStatus;
beforeEach(() => {
  localStorage.clear();
  setCloudEnabledForTests(true);
  resetCloudSession();
  useCloudSession.setState({ phase: "signedIn", user: USER });
  resetExchangeStore();
  server = status();
  useJournal.setState({ trades: [], settings: settings(), loaded: true, mode: "local" });
  vi.stubGlobal(
    "IntersectionObserver",
    class {
      constructor(private readonly cb: (entries: unknown[], obs: unknown) => void) {}
      observe(target: Element) {
        this.cb([{ target, isIntersecting: true, intersectionRatio: 1 }], this);
      }
      unobserve() {}
      disconnect() {}
      takeRecords() {
        return [];
      }
    },
  );
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: string) => {
      const url = new URL(input, "https://journal.test");
      if (url.pathname === "/api/v1/exchange/sync") return Response.json(server);
      return Response.json({ error: { code: "not_found", message: "Unbekannt." } }, { status: 404 });
    }),
  );
});
afterEach(() => {
  setCloudEnabledForTests(null);
  resetCloudSession();
  resetExchangeStore();
  vi.unstubAllGlobals();
});

const wrap = (ui: React.ReactNode) => render(<MotionRoot>{ui}</MotionRoot>);

describe("sync card scope note", () => {
  const expectScope = async () => {
    const scope = await screen.findByTestId("exchange-scope");
    expect(scope).toHaveTextContent(SCOPE_TEXT.syncReads);
    expect(scope).toHaveTextContent("Spot-Konto: wird nicht gelesen");
    expect(scope).toHaveTextContent("Coin-M / inverse Kontrakte: nicht unterstützt");
    expect(scope).toHaveTextContent("Hedge-Modus: Long und Short am selben Symbol kommen als getrennte Positionen");
    expect(scope).toHaveTextContent("Liquidationsnäherung rechnet jede Position für sich");
  };

  it("before a connection (hero)", async () => {
    wrap(<ExchangeConnectionsCard />);
    await screen.findByTestId("exchange-hero");
    await expectScope();
  });

  it("with a connection", async () => {
    server = status({ connections: [CONN] });
    wrap(<ExchangeConnectionsCard />);
    await screen.findByTestId("exchange-connected");
    await expectScope();
  });
});

describe("CSV sheet scope", () => {
  const HEDGE = [
    "Date(UTC),Symbol,Side,Price,Quantity,Amount,Fee,Realized Profit,Position Side",
    "2026-10-05 07:30:00,BTCUSDT,BUY,62000,0.05,3100,1 USDT,0,LONG",
    "2026-10-05 07:31:00,BTCUSDT,SELL,62100,0.05,3105,1 USDT,0,SHORT",
    "2026-10-05 10:00:00,BTCUSDT,SELL,63000,0.05,3150,1 USDT,50,LONG",
    "2026-10-05 10:05:00,BTCUSDT,BUY,62800,0.05,3140,1 USDT,15,SHORT",
    "2026-10-06 09:00:00,ETHUSDT,BUY,2400,1,2400,1 USDT,0,BOTH",
    "2026-10-06 11:00:00,ETHUSDT,SELL,2450,1,2450,1 USDT,49,BOTH",
  ].join("\n");

  it("names what is read and what is not before a file is chosen", async () => {
    wrap(<CsvImportSheet />);
    act(() => openCsvImport());
    const scope = await screen.findByTestId("csv-scope");
    expect(scope).toHaveTextContent("Unterstützt: lineare USDT-/USDC-Perps im Einweg-Modus");
    expect(scope).toHaveTextContent("Spot (Kraken, Coinbase, OKX Spot) nur als Long-Rundreisen ohne Hebel und Funding");
    expect(scope).toHaveTextContent("Nicht unterstützt: Coin-M / inverse Kontrakte");
    expect(scope).toHaveTextContent("Hedge-Modus");
  });

  it("a hedge-mode file: the legs are left out with a warning, the one-way rows are imported", async () => {
    const read = vi.fn(async () => HEDGE);
    wrap(<CsvImportSheet readFile={read} />);
    act(() => openCsvImport());
    fireEvent.change(await screen.findByTestId("csv-file"), { target: { files: [new File([HEDGE], "binance.csv", { type: "text/csv" })] } });
    const rows = await screen.findAllByTestId("csv-row");
    expect(rows).toHaveLength(1);
    expect(within(screen.getByTestId("csv-sheet")).getByText(/4 Zeilen aus dem Hedge-Modus \(Position Side LONG\/SHORT\) nicht importiert/)).toBeInTheDocument();
  });
});
