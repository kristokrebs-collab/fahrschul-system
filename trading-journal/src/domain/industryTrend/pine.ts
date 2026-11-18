/**
 * Pine Script v5 export of the Branchen-Trend rule: an INDICATOR for the chart of an industry ETF or index that marks the
 * signal days (green dot = in, red dot = out) and offers one `alertcondition` per direction with a JSON payload.
 *
 * Why not `toPine` of the lab (`@/domain/lab/pine`)? That one turns the rule tree of "Eigene Idee" into a v6 STRATEGY from the
 * lab's building blocks; the channel / Keltner / trailing-stop rule is not one of them, so there is nothing to reuse but the
 * conventions: readable text, an honest header, differences named, no tabs, 4-space steps, deterministic (snapshot-tested).
 *
 * Honest limits (also in the script header and in the card): the app can neither run nor compile Pine – the script was NOT
 * compiled in TradingView; the signal runs on the chart's closes of an ETF or index, not on the Ken-French industry returns, so
 * days can differ; daily candles only. Pure: no I/O, no clock.
 */
import { pyNumber, strategyId, type TrendParams } from "./config";

export interface PineScript {
  code: string;
  fileName: string;
  /** what will differ from the lab run, one sentence each */
  notes: string[];
  /** the JSON the two alerts send (placeholders `{{…}}` are filled by TradingView) */
  payloadExample: { kauf: string; verkauf: string };
}

/** The JSON of an alert: schema, strategy id, direction and what TradingView can fill in. */
export const PAYLOAD_SCHEMA_ID = "branchen-trend/1";

export function payloadTemplate(strategie: string, signal: "KAUF" | "VERKAUF"): string {
  return `{"schema":"${PAYLOAD_SCHEMA_ID}","strategie":"${strategie}","signal":"${signal}","symbol":"{{ticker}}","datum":"{{time}}","kurs":{{close}},"modus":"DEMO/PAPIER"}`;
}

/**
 * JSON Schema (draft 2020-12) of the alert payload – for whoever connects an automation later (n8n, a webhook). It describes
 * the message AFTER TradingView has filled the placeholders.
 */
export const PAYLOAD_JSON_SCHEMA = {
  $schema: "https://json-schema.org/draft/2020-12/schema",
  title: "Branchen-Trend Signal",
  type: "object",
  additionalProperties: false,
  required: ["schema", "strategie", "signal", "symbol", "datum", "kurs", "modus"],
  properties: {
    schema: { const: PAYLOAD_SCHEMA_ID },
    strategie: { type: "string", pattern: "^s-[0-9.-]+$", description: "Kennung der Variante, z. B. s-20-40-2.8-0.02-2.0" },
    signal: { enum: ["KAUF", "VERKAUF"] },
    symbol: { type: "string", description: "{{ticker}} des Charts, z. B. XLE" },
    datum: { type: "string", format: "date-time", description: "{{time}}: Beginn des Tagesbalkens (UTC)" },
    kurs: { type: "number", description: "{{close}} des Balkens" },
    modus: { const: "DEMO/PAPIER", description: "Nur Protokoll; die App sendet keine Orders" },
  },
} as const;

const fl = (v: number): string => (Number.isInteger(v) ? v.toFixed(1) : String(v));

export function buildPine(params: TrendParams): PineScript {
  const id = strategyId(params);
  const kauf = payloadTemplate(id, "KAUF");
  const verkauf = payloadTemplate(id, "VERKAUF");
  const notes = [
    "Nicht in TradingView kompiliert: Die App kann Pine weder ausführen noch prüfen. Meldet TradingView einen Fehler, steht er im Skript selbst.",
    "Gerechnet wird auf den Schlusskursen des Charts (ETF oder Index), nicht auf den Branchenrenditen von Ken French. Kurse, Dividenden und Historie unterscheiden sich, Signaltage können abweichen.",
    "Nur Tageskerzen. Auf anderen Zeitrahmen warnt das Skript und die Fenster (Tage) wären Balken.",
    "Der gleitende Durchschnitt (EMA) startet mit dem ersten Kurs, wie im Labor-Skript – nicht wie ta.ema von TradingView, das mit einem einfachen Durchschnitt beginnt.",
    "Ziel-Vola, Hebel und Kosten (5 bp) gehören zur Gewichtung des Portfolios und stehen nicht im Skript: Es markiert nur Signaltage.",
    "Alarme: beim Anlegen „Einmal pro Balkenschluss“ wählen, sonst meldet TradingView ein Signal mitten am Tag, das der Schlusskurs wieder zurücknehmen kann.",
  ];
  const code = [
    "//@version=5",
    "// Branchen-Trend: Nachbau der Regel aus Zarattini & Antonacci (2024), „A Century of Profitable Industry Trends“.",
    `// Variante ${id}: oberer Kanal ${params.up} Tage, unterer Kanal ${params.down} Tage, Keltner-Faktor ${pyNumber(params.kelt)}.`,
    "// Rückblick-Regel, keine Prognose und keine Anlageberatung. Das Skript sendet keine Orders; es markiert nur Signaltage.",
    "// NICHT in TradingView kompiliert oder geprüft – siehe die Hinweise der App. Nur Tageskerzen.",
    ...notes.map((n) => `//   - ${n}`),
    "",
    `indicator("Branchen-Trend (Nachbau)", shorttitle = "Branchen-Trend", overlay = true, max_labels_count = 50)`,
    "",
    `upLen = input.int(${params.up}, "Oberer Kanal: Fenster (Tage)", minval = 2)`,
    `downLen = input.int(${params.down}, "Unterer Kanal und Stop: Fenster (Tage)", minval = 2)`,
    `kelt = input.float(${fl(params.kelt)}, "Keltner-Faktor", minval = 0.0, step = 0.1)`,
    `showLines = input.bool(true, "Kanäle und Stop zeigen")`,
    "",
    "// EMA wie im Labor-Skript: Start mit dem ersten Wert",
    "f_ema(src, len) =>",
    "    float a = 2.0 / (len + 1)",
    "    float e = na",
    "    e := na(e[1]) ? src : a * src + (1 - a) * e[1]",
    "    e",
    "",
    "float absChg = math.abs(ta.change(close))",
    "float hi = ta.highest(close, upLen)",
    "float lo = ta.lowest(close, downLen)",
    "float madUp = ta.sma(absChg, upLen)",
    "float madDn = ta.sma(absChg, downLen)",
    "float emaUp = f_ema(close, upLen)",
    "float emaDn = f_ema(close, downLen)",
    "",
    "// Kanäle: erst definiert, wenn das Fenster voll ist (wie im Labor-Skript)",
    "float upper = bar_index >= upLen ? math.max(hi, emaUp + kelt * madUp) : na",
    "float lower = bar_index >= downLen ? math.min(lo, emaDn - kelt * madDn) : na",
    "",
    "// Zustand: 1 = im Markt (grün), 0 = Cash (rot). Einstieg: Schluss auf oder über dem oberen Kanal von gestern.",
    "// Stop: der untere Kanal beim Einstieg, danach nur nach oben nachgezogen; Ausstieg bei Schluss auf oder unter dem Stop.",
    "var int inTrade = 0",
    "var float stopLevel = na",
    "int prevOn = nz(inTrade[1])",
    "float prevUp = upper[1]",
    "float prevLo = lower[1]",
    "if bar_index == 0 or na(prevUp) or na(prevLo)",
    "    inTrade := 0",
    "else if inTrade == 1",
    "    if not na(lower)",
    "        stopLevel := na(stopLevel) ? lower : math.max(stopLevel, lower)",
    "    if close <= stopLevel",
    "        inTrade := 0",
    "else if close >= prevUp and prevUp > prevLo",
    "    inTrade := 1",
    "    stopLevel := lower",
    "",
    "bool buySig = inTrade == 1 and prevOn != 1",
    "bool sellSig = inTrade == 0 and prevOn == 1",
    "",
    `plot(showLines ? upper : na, "Oberer Kanal", color = color.new(color.green, 35), linewidth = 1)`,
    `plot(showLines ? lower : na, "Unterer Kanal", color = color.new(color.red, 35), linewidth = 1)`,
    `plot(showLines and inTrade == 1 ? stopLevel : na, "Stop (nur nach oben)", color = color.new(color.orange, 20), style = plot.style_linebr, linewidth = 1)`,
    `plotshape(buySig, "Kauf", style = shape.circle, location = location.belowbar, color = color.green, size = size.small)`,
    `plotshape(sellSig, "Verkauf", style = shape.circle, location = location.abovebar, color = color.red, size = size.small)`,
    `bgcolor(inTrade == 1 ? color.new(color.green, 93) : na, title = "Im Markt")`,
    "",
    "if barstate.islast and not timeframe.isdaily",
    `    label.new(bar_index, high, "Branchen-Trend ist für Tageskerzen gedacht (Zeitrahmen 1T).", style = label.style_label_down, color = color.new(color.orange, 15), textcolor = color.white)`,
    "",
    "// Alarme mit JSON-Nachricht; TradingView ersetzt {{ticker}}, {{time}} und {{close}}.",
    `alertcondition(buySig, title = "Branchen-Trend: KAUF", message = '${kauf}')`,
    `alertcondition(sellSig, title = "Branchen-Trend: VERKAUF", message = '${verkauf}')`,
    "",
  ].join("\n");
  return { code, fileName: `Branchen-Trend_${id}.pine`, notes, payloadExample: { kauf, verkauf } };
}
