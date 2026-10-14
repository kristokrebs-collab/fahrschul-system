import { AnimatePresence, motion } from "motion/react";
import { useState } from "react";
import { TextRoll } from "@/motion/TextRoll";
import { tween } from "@/motion/tokens";
import { useReducedFx } from "@/motion/useReducedFx";
import { Button } from "@/primitives/Button";
import { Card } from "@/primitives/Card";
import { requestCapability } from "@/store/capability";
import type { DraftTextKey, SettingsDraft } from "./draft";
import { DraftField } from "./fields";
import { GlyphLink, PhaseGlyph } from "./fx";

/** MCP server name of the bundle (`Vf`). */
export const HYBLOCK_SERVER = "Hyblock";
export const HYBLOCK_TOOL = "hyblock_get";

export const HYBLOCK_STRINGS = {
  title: "Hyblock-Connector",
  introA: "Endpunkte und Feldnamen aus der Hyblock-API-Doku (v2, ohne ",
  introB: "). Leeres Feld = automatisch erkennen. „Testen“ zeigt, welche Felder die Antwort enthält.",
  /** NEW (Plan 4.10 / decision 10): live values come from Binance without a key. */
  binanceNote:
    "Ohne Hyblock-Verbindung kommen Top-Trader-Long-% und Delta ohne Key direkt von Binance. Ein Hyblock-Key liegt nie im Browser: auf claude.ai läuft der Connector, auf Netlify ein serverseitiger Proxy.",
  longEndpoint: "Endpunkt Top-Trader Long",
  longField: "Feld Long %",
  longFieldHelp: "z. B. longPercentage",
  deltaEndpoint: "Endpunkt Whale-Delta",
  deltaField: "Feld Delta",
  deltaFieldHelp: "z. B. delta",
  coin: "Coin",
  exchange: "Exchange",
  timeframe: "Timeframe",
  timeframeHelp: "steuert auch die Kerzen-Basis der Binance-Ratios",
  test: "Verbindung testen",
  testing: "Teste …",
  onlyClaude: "Nur auf claude.ai verfügbar.",
  proxyMissing: "Hyblock-Proxy nicht konfiguriert.",
  notConnected: `Connector „${HYBLOCK_SERVER}“ nicht verbunden`,
} as const;

export interface HyblockTestConfig {
  /** Non-empty endpoints only (`hbLong`, `hbDelta`). */
  endpoints: string[];
  /** `{ coin, exchange, timeframe, limit: 3 }` with empty strings removed. */
  params: Record<string, string | number>;
}

/** Bundle `Wf`: unwrap the tool payload into rows. */
export function unwrapRows(e: unknown): unknown[] {
  if (Array.isArray(e)) return e;
  const o = e as Record<string, unknown> | null | undefined;
  if (!o || typeof o !== "object") return [];
  for (const k of ["data", "result", "items", "values"]) {
    if (Array.isArray(o[k])) return o[k] as unknown[];
  }
  if (o.data && typeof o.data === "object") return unwrapRows(o.data);
  return [o];
}

/** Bundle `Che` output line: `{endpoint}: {n} Werte · Felder: k=v, …` (strings truncated to 16 chars). */
export function describeRows(endpoint: string, rows: unknown[]): string {
  const last = rows[rows.length - 1];
  const fields =
    last && typeof last === "object"
      ? Object.entries(last as Record<string, unknown>)
          .map(([k, v]) => `${k}=${typeof v === "number" ? v : String(v).slice(0, 16)}`)
          .join(", ")
      : "–";
  return `${endpoint}: ${rows.length} Werte · Felder: ${fields}`;
}

/** Bundle `Che` error line: raw error code, `tool_error` message truncated to 200 chars. */
export function describeError(endpoint: string, err: unknown): string {
  const e = err as { code?: unknown; message?: unknown } | null | undefined;
  const code = typeof e?.code === "string" ? e.code : "";
  if (code === "server_not_connected") return `${endpoint}: ${HYBLOCK_STRINGS.notConnected}`;
  if (code === "tool_error") return `${endpoint}: ${String(e?.message || "Fehler").slice(0, 200)}`;
  return `${endpoint}: ${code || "Fehler"}`;
}

interface McpHandle {
  callTool(server: string, tool: string, input: unknown, opts?: { cache?: boolean }): Promise<unknown>;
}

/**
 * Default `Verbindung testen` runner (Bundle `Che`, 1:1): `window.claude.use("mcp")` →
 * one `hyblock_get` per endpoint with `limit: 3`. No MCP handle → `Nur auf claude.ai verfügbar.`.
 */
export async function runHyblockTest(cfg: HyblockTestConfig): Promise<string[]> {
  const mcp = await requestCapability<McpHandle>("mcp");
  if (!mcp || typeof mcp.callTool !== "function") return [HYBLOCK_STRINGS.onlyClaude];
  const lines: string[] = [];
  for (const endpoint of cfg.endpoints) {
    try {
      const res = (await mcp.callTool(HYBLOCK_SERVER, HYBLOCK_TOOL, { endpoint: endpoint.trim(), params: cfg.params }, { cache: false })) as
        | { payload?: unknown; structuredContent?: unknown }
        | null
        | undefined;
      lines.push(describeRows(endpoint, unwrapRows(res?.payload ?? res?.structuredContent)));
    } catch (err) {
      lines.push(describeError(endpoint, err));
    }
  }
  return lines;
}

export function testConfigFromDraft(d: SettingsDraft): HyblockTestConfig {
  const raw: Record<string, string | number> = { coin: d.hbCoin, exchange: d.hbExchange, timeframe: d.hbTf, limit: 3 };
  return {
    endpoints: [d.hbLong, d.hbDelta].filter((e) => e && e.trim()),
    params: Object.fromEntries(Object.entries(raw).filter(([, v]) => v !== "" && v != null)),
  };
}

export interface HyblockConnectorCardProps {
  draft: SettingsDraft;
  onChange: (key: DraftTextKey, value: string) => void;
  /** Injected test runner (integrator / tests); defaults to the MCP path. */
  onTest?: (cfg: HyblockTestConfig) => Promise<string[]>;
  className?: string;
}

/**
 * `Hyblock-Connector` card (Plan 6.4): config fields + `Verbindung testen` output in a `<pre>`. The button spins
 * while the test runs (label morphs to `Teste …`); each new result fades up in place.
 */
export function HyblockConnectorCard({ draft, onChange, onTest = runHyblockTest, className }: HyblockConnectorCardProps) {
  const [lines, setLines] = useState<string[] | null>(null);
  const [testing, setTesting] = useState(false);
  const [run, setRun] = useState(0);
  const reduced = useReducedFx();

  async function test() {
    setTesting(true);
    setRun((n) => n + 1);
    try {
      setLines(await onTest(testConfigFromDraft(draft)));
    } catch (err) {
      setLines([describeError("Test", err)]);
    } finally {
      setTesting(false);
    }
  }

  return (
    <Card title={HYBLOCK_STRINGS.title} className={className}>
      <p className="mb-2 max-w-[80ch] text-[13px] text-mute">
        {HYBLOCK_STRINGS.introA}
        <span className="font-mono">/v2</span>
        {HYBLOCK_STRINGS.introB}
      </p>
      <p className="mb-4 max-w-[80ch] text-[12.5px] text-faint">{HYBLOCK_STRINGS.binanceNote}</p>
      <div className="grid grid-cols-2 gap-3.5 md:grid-cols-4">
        <DraftField id="hbLong" label={HYBLOCK_STRINGS.longEndpoint} numeric={false} draft={draft} onChange={onChange} />
        <DraftField id="hbLongField" label={HYBLOCK_STRINGS.longField} help={HYBLOCK_STRINGS.longFieldHelp} numeric={false} draft={draft} onChange={onChange} />
        <DraftField id="hbDelta" label={HYBLOCK_STRINGS.deltaEndpoint} numeric={false} draft={draft} onChange={onChange} />
        <DraftField id="hbDeltaField" label={HYBLOCK_STRINGS.deltaField} help={HYBLOCK_STRINGS.deltaFieldHelp} numeric={false} draft={draft} onChange={onChange} />
        <DraftField id="hbCoin" label={HYBLOCK_STRINGS.coin} numeric={false} draft={draft} onChange={onChange} />
        <DraftField id="hbExchange" label={HYBLOCK_STRINGS.exchange} numeric={false} draft={draft} onChange={onChange} />
        <DraftField id="hbTf" label={HYBLOCK_STRINGS.timeframe} help={HYBLOCK_STRINGS.timeframeHelp} numeric={false} draft={draft} onChange={onChange} />
      </div>
      <div className="mt-4 grid gap-2">
        <Button size="sm" className="justify-self-start" onClick={test} disabled={testing} aria-busy={testing || undefined}>
          <PhaseGlyph phase={testing ? "busy" : "idle"} icon={<GlyphLink />} />
          <TextRoll mode="roll" text={testing ? HYBLOCK_STRINGS.testing : HYBLOCK_STRINGS.test} />
        </Button>
        {lines && (
          <pre role="status" className="overflow-x-auto whitespace-pre-wrap rounded-xl border border-line bg-ink-950/60 p-3 font-mono text-[11.5px] text-mute">
            <AnimatePresence mode="popLayout" initial={false}>
              <motion.span key={run} className="block" initial={reduced ? false : { opacity: 0, y: 4 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, transition: tween.exit }} transition={tween.fade}>
                {lines.join("\n")}
              </motion.span>
            </AnimatePresence>
          </pre>
        )}
      </div>
    </Card>
  );
}
