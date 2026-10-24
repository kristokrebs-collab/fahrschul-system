/**
 * The vocabulary of exchange screenshots (EN / DE) – constants and small pure readers, nothing else.
 *
 * Labels are matched after folding (`fold`: lower case, no diacritics, no punctuation) and fuzzily (`matchLabel`: a
 * tolerance of ~ 1 wrong letter per 6, because the engine reads „geöffnet“ as „gedffnet“). The phrases are the ones the
 * exchanges' apps and sites print on their order / position / trade histories; `KNOWN_LAYOUTS` lists the column
 * headers per exchange and view as far as they are public knowledge. Unknown layouts are NOT guessed: whatever has no
 * known label falls back to the pattern reader in `layout.ts` (symbols, times, numbers) and shows up as uncertain.
 */

/** What a cell / row of a history can say. */
export type FieldId =
  | "symbol"
  | "side"
  | "action"
  | "orderType"
  | "qty"
  | "orderQty"
  | "maxQty"
  | "entry"
  | "exit"
  | "price"
  | "orderPrice"
  | "fee"
  | "funding"
  | "pnl"
  | "roi"
  | "openTime"
  | "closeTime"
  | "time"
  | "leverage"
  | "margin"
  | "status";

/** Lower case, no diacritics (ä → a, ß → ss), letters / digits / "&" and single spaces only. */
export function fold(s: string): string {
  return s
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/ß/g, "ss")
    .replace(/p\s*&\s*l/g, "pnl")
    .replace(/[^a-z0-9% ]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** Levenshtein distance (small strings only). */
export function distance(a: string, b: string): number {
  if (a === b) return 0;
  if (!a.length) return b.length;
  if (!b.length) return a.length;
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const cur = [i];
    for (let j = 1; j <= b.length; j++) cur[j] = Math.min(prev[j]! + 1, cur[j - 1]! + 1, prev[j - 1]! + (a[i - 1] === b[j - 1] ? 0 : 1));
    prev = cur;
  }
  return prev[b.length]!;
}

/** Phrases per field, already folded. The order inside a field does not matter. */
export const LABELS: Record<FieldId, readonly string[]> = {
  symbol: ["symbol", "kontrakt", "kontrakte", "contract", "contracts", "pair", "paar", "markt", "market", "instrument", "futures", "perpetual", "handelspaar", "trading pair", "coin"],
  side: ["seite", "side", "richtung", "direction", "long short", "kauf verkauf", "buy sell", "position side", "positionsseite"],
  action: ["trade type", "handelsart", "aktion", "operation", "order action", "open close", "offnen schliessen", "typ aktion"],
  orderType: ["order type", "ordertyp", "auftragsart", "auftragstyp", "type", "typ", "art", "order art"],
  qty: [
    "geschlossene menge",
    "geschlossene grosse",
    "schliessmenge",
    "menge",
    "grosse",
    "anzahl",
    "qty",
    "quantity",
    "size",
    "amount",
    "closed qty",
    "closed quantity",
    "closed amount",
    "closed size",
    "closed vol",
    "closed volume",
    "close qty",
    "close amount",
    "close vol",
    "closing qty",
    "position size",
    "volume",
    "vol",
    "position closed",
    "ausgefuhrte menge",
    "executed qty",
    "filled qty",
    "filled quantity",
    "filled amount",
    "executed",
    "filled",
    "ausgefuhrt",
    "gefullt",
    "fill qty",
    "fill size",
    "trade qty",
    "trade amount",
  ],
  orderQty: ["auftragsmenge", "ordermenge", "order qty", "order quantity", "order amount", "order size", "gesamtmenge", "total qty", "filled total", "filled order qty"],
  maxQty: ["maximal gehalten", "maximal gehaltene menge", "max gehalten", "max position", "max held", "max position size", "max open interest", "max size", "maximale position", "hochste menge", "max qty", "max holding"],
  entry: [
    "einstiegspreis",
    "durchschnittlicher einstiegspreis",
    "durchschn einstiegspreis",
    "einstieg",
    "eroffnungspreis",
    "eroffnungskurs",
    "einstiegskurs",
    "entry price",
    "avg entry price",
    "avg entry",
    "average entry price",
    "entry",
    "entry px",
    "open price",
    "avg open price",
    "avg open",
    "average open price",
    "opening price",
    "avg opening price",
    "open px",
    "avg price open",
  ],
  exit: [
    "schlusspreis",
    "schlusskurs",
    "durchschnittlicher schlusspreis",
    "ausstiegspreis",
    "ausstiegskurs",
    "ausstieg",
    "schliessungspreis",
    "schliesspreis",
    "close price",
    "closing price",
    "exit price",
    "avg close price",
    "avg closing price",
    "avg exit price",
    "avg close",
    "average close price",
    "average exit price",
    "avg exit",
    "exit",
    "close px",
    "avg price close",
  ],
  price: ["durchschnittspreis", "durchschnittlicher fullpreis", "ausfuhrungspreis", "fullpreis", "filled price", "avg fill price", "avg filled price", "average", "avg price", "avg", "average price", "fill price", "executed price", "price", "preis", "kurs", "trade price", "execution price", "exec price", "deal price"],
  orderPrice: ["auftragspreis", "orderpreis", "limitpreis", "order price", "limit price", "limit", "price order"],
  fee: ["gebuhr", "gebuhren", "handelsgebuhr", "handelsgebuhren", "transaktionsgebuhr", "trading fee", "trade fee", "transaction fee", "tx fee", "fee", "fees", "commission", "provision", "total fee"],
  funding: ["funding", "funding fee", "funding fees", "funding gebuhr", "funding gebuhren", "finanzierung", "finanzierungsgebuhr", "funding cost", "funding payment"],
  pnl: [
    "position pnl",
    "position pnl gewinn und verlust",
    "position pnl gewinn verlust",
    "realisierter pnl",
    "realisierter gewinn",
    "realisierter gewinn und verlust",
    "realisierter gewinn verlust",
    "realisierter gewinn pnl",
    "gewinn und verlust",
    "gewinn verlust",
    "gewinn",
    "ergebnis",
    "pnl",
    "pnl usdt",
    "realized pnl",
    "realised pnl",
    "realized profit",
    "realized profit and loss",
    "realized profit loss",
    "closed pnl",
    "closing pnl",
    "closed profit",
    "closing profit",
    "profit",
    "profit loss",
    "profit and loss",
    "net pnl",
    "net profit",
    "pnl net",
    "result",
    "p l",
  ],
  roi: ["roi", "roe", "pnl ratio", "pnl %", "pnl prozent", "rendite", "ertrag", "return", "return %", "pnl rate", "gewinnquote", "profit rate"],
  openTime: [
    "zeit geoffnet",
    "geoffnet am",
    "geoffnet",
    "eroffnet",
    "zeit eroffnet",
    "eroffnungszeit",
    "offnungszeit",
    "einstiegszeit",
    "open time",
    "opened",
    "opened at",
    "opened time",
    "opening time",
    "entry time",
    "open date",
    "time opened",
    "position opened",
    "created time",
    "open at",
  ],
  closeTime: [
    "zeit geschlossen",
    "geschlossen am",
    "schliessungszeit",
    "schliesszeit",
    "zeit schliessung",
    "ausstiegszeit",
    "abschlusszeit",
    "close time",
    "closed",
    "closed at",
    "closed time",
    "closing time",
    "exit time",
    "close date",
    "time closed",
    "position closed time",
    "close at",
  ],
  time: ["zeit", "datum", "datum zeit", "time", "date", "date time", "order time", "auftragszeit", "ordnungszeit", "exec time", "execution time", "trade time", "ausfuhrungszeit", "updated time", "erstellungszeit", "aktualisiert", "transaktionszeit", "created at", "created", "update time", "filled time"],
  leverage: ["hebel", "leverage", "lev", "hebel x", "hebelwirkung"],
  margin: ["margin", "einsatz", "initial margin", "position margin", "marge", "used margin"],
  status: ["status", "zustand", "state", "order status"],
};

export interface LabelMatch {
  field: FieldId;
  /** 0–1: 1 = the folded label IS a phrase of the field. */
  score: number;
  /** The unit in parentheses („(USDT)“, „(BTC)“) – a quantity's unit is the base asset. */
  unit: string | null;
}

/** Text and parenthesised unit of a label: „Schlusspreis (USDT)“ → `{ text: "Schlusspreis", unit: "USDT" }`. */
export function splitUnit(label: string): { text: string; unit: string | null } {
  const m = /\(([^()]{1,12})\)\s*$/.exec(label.trim());
  if (!m) return { text: label.trim(), unit: null };
  const unit = m[1]!.trim();
  // a unit is a short upper-case asset code; „(Gewinn und Verlust)“ is part of the label
  return /^[A-Za-z0-9]{2,10}$/.test(unit) && unit === unit.toUpperCase() ? { text: label.slice(0, m.index).trim(), unit } : { text: label.trim(), unit: null };
}

const PHRASES: { field: FieldId; phrase: string }[] = (Object.keys(LABELS) as FieldId[]).flatMap((field) => LABELS[field].map((phrase) => ({ field, phrase })));

/**
 * Which field a label names, or `null`. Exact folded match first, then the best fuzzy one (distance ≤ 1 per 6 letters,
 * at least 5 letters long – a four-letter label such as „Zeit“ must be exact).
 */
export function matchLabel(label: string): LabelMatch | null {
  const { text, unit } = splitUnit(label);
  const folded = fold(text.replace(/\([^)]*\)/g, " "));
  if (!folded) return null;
  let best: LabelMatch | null = null;
  for (const { field, phrase } of PHRASES) {
    if (phrase === folded) return { field, score: 1, unit };
    if (folded.length < 5 || phrase.length < 5) continue;
    const d = distance(folded, phrase);
    const allowed = Math.floor(Math.max(folded.length, phrase.length) / 6);
    if (d > allowed) continue;
    const score = 1 - d / Math.max(folded.length, phrase.length);
    if (!best || score > best.score) best = { field, score, unit };
  }
  return best;
}

/* ------------------------------------------------------------------ tabs / views */

export type ViewId = "orders" | "positions" | "trades" | "open" | "unknown";

/** Tab titles of the order / position / trade history, folded. */
export const TABS: Record<Exclude<ViewId, "unknown">, readonly string[]> = {
  orders: ["auftragshistorie", "orderhistorie", "order history", "orders history", "order historie", "historische auftrage", "order details", "orderverlauf"],
  positions: ["positionshistorie", "position history", "positions history", "position historie", "closed pnl", "closed p l", "closed positions", "geschlossene positionen", "positionsverlauf"],
  trades: ["tradehistorie", "trade history", "trades history", "handelshistorie", "trade historie", "fill history", "fills", "ausfuhrungen", "transaction history", "handelsverlauf"],
  open: ["offene auftrage", "open orders", "aktuelle auftrage", "current orders", "offene positionen", "open positions", "positionen", "positions", "aktuelle positionen"],
};

export const VIEW_LABEL: Record<ViewId, string> = {
  orders: "Orderhistorie",
  positions: "Positionshistorie",
  trades: "Tradehistorie",
  open: "Offene Positionen / Orders",
  unknown: "Unbekannte Ansicht",
};

/** The view a tab title belongs to (fuzzy: „Positionshistorie“ read as „Positionshistorle“ still counts). */
export function matchTab(text: string): ViewId | null {
  const f = fold(text);
  if (f.length < 4) return null;
  let best: { view: ViewId; d: number } | null = null;
  for (const view of Object.keys(TABS) as Exclude<ViewId, "unknown">[])
    for (const p of TABS[view]) {
      const d = distance(f, p);
      if (d <= Math.floor(p.length / 7) && (!best || d < best.d)) best = { view, d };
    }
  return best?.view ?? null;
}

/* ------------------------------------------------------------------ exchanges */

/** Brand words an exchange's page may show (logo text, a title). Only a brand that is READ names the exchange. */
export const EXCHANGE_BRANDS: readonly { id: string; name: string; words: readonly string[] }[] = [
  { id: "bitunix", name: "Bitunix", words: ["bitunix"] },
  { id: "bybit", name: "Bybit", words: ["bybit"] },
  { id: "binance", name: "Binance", words: ["binance"] },
  { id: "bingx", name: "BingX", words: ["bingx"] },
  { id: "mexc", name: "MEXC", words: ["mexc"] },
  { id: "okx", name: "OKX", words: ["okx"] },
  { id: "bitget", name: "Bitget", words: ["bitget"] },
  { id: "kucoin", name: "KuCoin", words: ["kucoin"] },
  { id: "blofin", name: "BloFin", words: ["blofin"] },
];

/**
 * Column headers of the histories, per exchange and view, as printed on the web / app (public knowledge, not a
 * promise that every app version looks like this). Used to NAME a layout and to test that the dictionary above reads
 * every one of them; a header that is not in this table is simply read by its own words.
 */
export interface KnownLayout {
  exchange: string;
  view: Exclude<ViewId, "unknown" | "open">;
  /** Header cells in display order. */
  headers: readonly string[];
  /** What each header must be read as (same order); `null` = intentionally not a field of ours. */
  fields: readonly (FieldId | null)[];
}

export const KNOWN_LAYOUTS: readonly KnownLayout[] = [
  {
    exchange: "bitunix",
    view: "positions",
    headers: ["Position PnL (Gewinn und Verlust)", "ROI", "Einstiegspreis", "Schlusspreis (USDT)", "Maximal gehalten (BTC)", "Geschlossene Menge (BTC)", "Zeit geöffnet", "Zeit geschlossen"],
    fields: ["pnl", "roi", "entry", "exit", "maxQty", "qty", "openTime", "closeTime"],
  },
  {
    exchange: "bitunix",
    view: "orders",
    headers: ["Realisierter PnL", "Durchschnittspreis", "Auftragspreis", "Auftragsmenge", "Ausgeführt", "Gebühr", "Status"],
    fields: ["pnl", "price", "orderPrice", "orderQty", "qty", "fee", "status"],
  },
  {
    exchange: "bybit",
    view: "positions",
    headers: ["Contracts", "Qty", "Entry Price", "Exit Price", "Closed P&L", "Closed Time"],
    fields: ["symbol", "qty", "entry", "exit", "pnl", "closeTime"],
  },
  {
    exchange: "bybit",
    view: "orders",
    headers: ["Contracts", "Filled Price", "Order Price", "Status", "Order Time"],
    fields: ["symbol", "price", "orderPrice", "status", "time"],
  },
  {
    exchange: "bybit",
    view: "trades",
    headers: ["Contracts", "Trade Type", "Filled Price", "Filled Qty", "Trading Fee", "Exec Time"],
    fields: ["symbol", "action", "price", "qty", "fee", "time"],
  },
  {
    exchange: "binance",
    view: "orders",
    headers: ["Time", "Symbol", "Type", "Side", "Average", "Price", "Executed", "Status"],
    fields: ["time", "symbol", "orderType", "side", "price", "price", "qty", "status"],
  },
  {
    exchange: "binance",
    view: "trades",
    headers: ["Time", "Symbol", "Side", "Price", "Quantity", "Fee", "Realized Profit"],
    fields: ["time", "symbol", "side", "price", "qty", "fee", "pnl"],
  },
  {
    exchange: "binance",
    view: "positions",
    headers: ["Symbol", "Avg. Entry Price", "Avg. Close Price", "Closed Vol.", "Closing PNL"],
    fields: ["symbol", "entry", "exit", "qty", "pnl"],
  },
  {
    exchange: "okx",
    view: "positions",
    headers: ["Position", "Avg open price", "Avg close price", "Closed qty", "Realized PnL", "PnL ratio"],
    fields: [null, "entry", "exit", "qty", "pnl", "roi"],
  },
  {
    exchange: "okx",
    view: "trades",
    headers: ["Trade time", "Instrument", "Side", "Fill price", "Fill size", "Fee", "Realized PnL"],
    fields: ["time", "symbol", "side", "price", "qty", "fee", "pnl"],
  },
  {
    exchange: "bingx",
    view: "positions",
    headers: ["Avg. Entry Price", "Avg. Close Price", "Closed Qty", "Realized PNL", "Open Time", "Close Time"],
    fields: ["entry", "exit", "qty", "pnl", "openTime", "closeTime"],
  },
  {
    exchange: "mexc",
    view: "positions",
    headers: ["Avg Entry Price", "Close Price", "Closed Vol", "Realized PNL", "Open Time", "Close Time"],
    fields: ["entry", "exit", "qty", "pnl", "openTime", "closeTime"],
  },
  {
    exchange: "bitget",
    view: "positions",
    headers: ["Avg entry price", "Avg closing price", "Closed amount", "Realized PnL", "Opened at", "Closed at"],
    fields: ["entry", "exit", "qty", "pnl", "openTime", "closeTime"],
  },
  {
    exchange: "kucoin",
    view: "positions",
    headers: ["Avg Entry Price", "Avg Exit Price", "Closed Qty", "Realized PNL", "Opening Time", "Closing Time"],
    fields: ["entry", "exit", "qty", "pnl", "openTime", "closeTime"],
  },
  {
    exchange: "blofin",
    view: "positions",
    headers: ["Avg. Open Price", "Avg. Close Price", "Closed Qty", "Closed PnL", "Open Time", "Closing Time"],
    fields: ["entry", "exit", "qty", "pnl", "openTime", "closeTime"],
  },
];

/* ------------------------------------------------------------------ value tokens */

const QUOTE = "USDT|USDC|USD|BUSD|EUR|DAI|FDUSD|TUSD";
/** `BTCUSDT`, `ETH-USDT`, `BTC/USDT`, `BTCUSDT.P`, `BTC-PERP`, `SOL_USDT`, `1000PEPEUSDT`, `BTCUSD_PERP`, `BTC-USDT-SWAP`. */
const SYMBOL = new RegExp(String.raw`^[A-Z0-9]{2,15}(?:[-_/ ]?(?:${QUOTE}|PERP|SWAP)|(?:${QUOTE}))(?:[-_/.](?:P|PERP|SWAP|USDT|USD))?$`);

/** True for a trading symbol as the exchanges print it (upper case, with a quote asset or PERP / SWAP). */
export function isSymbol(text: string): boolean {
  const t = text.trim().replace(/^[^A-Za-z0-9]+|[^A-Za-z0-9.]+$/g, "");
  if (t.length < 5 || t.length > 24) return false;
  if (!/[A-Z]{2}/.test(t)) return false;
  return SYMBOL.test(t.toUpperCase()) && t === t.toUpperCase();
}

/** The base asset of a symbol (`BTCUSDT` → `BTC`, `ETH-USDT-SWAP` → `ETH`), `null` when it has no recognisable quote. */
export function baseAsset(symbol: string): string | null {
  const t = symbol.toUpperCase().replace(/[^A-Z0-9]/g, "");
  const m = new RegExp(`^(.{2,15}?)(?:${QUOTE}|PERP|SWAP)`).exec(t);
  return m ? m[1]!.replace(/^1000+/, "") || null : null;
}

export type SideWord = "long" | "short" | "buy" | "sell";

/** „Long“, „Short“, „Kauf“, „Buy“ … (folded match, one OCR slip allowed). */
export function parseSideWord(text: string): SideWord | null {
  const f = fold(text);
  if (!f) return null;
  const table: [SideWord, readonly string[]][] = [
    ["long", ["long", "lang"]],
    ["short", ["short", "kurz"]],
    ["buy", ["buy", "kauf", "kaufen", "bid"]],
    ["sell", ["sell", "verkauf", "verkaufen", "ask"]],
  ];
  for (const [w, list] of table) for (const p of list) if (f === p || (p.length >= 4 && distance(f, p) <= 1)) return w;
  return null;
}

export type MarginWord = "isolated" | "cross";

export function parseMarginWord(text: string): MarginWord | null {
  const f = fold(text);
  if (!f) return null;
  for (const p of ["isoliert", "isolated", "iso"]) if (f === p || (p.length >= 5 && distance(f, p) <= 2)) return "isolated";
  for (const p of ["cross", "crossed", "quer", "cross margin", "kreuz"]) if (f === p || (p.length >= 5 && distance(f, p) <= 1)) return "cross";
  return null;
}

/**
 * „5X“, „10x“, „15X“, „x20“, „20×“ – leverage. The engine often reads the 5 as an S, the 0 as O, the 1 as l, the 8 as B:
 * the digits of the token are repaired when it is clearly a leverage (digits-or-lookalikes + X).
 */
export function parseLeverageToken(text: string): { value: number; repaired: boolean } | null {
  const t = text.trim();
  const m = /^(?:[xX×]\s*([0-9SOolIB]{1,3})|([0-9SOolIB]{1,3})\s*[xX×])$/.exec(t);
  if (!m) return null;
  const raw = (m[1] ?? m[2])!;
  const fixed = raw.replace(/[Ss]/g, "5").replace(/[Oo]/g, "0").replace(/[lI]/g, "1").replace(/B/g, "8");
  const v = Number(fixed);
  if (!Number.isFinite(v) || v < 1 || v > 1001) return null;
  return { value: v, repaired: fixed !== raw };
}

export type OrderAction = { action: "open" | "close"; side: "long" | "short" };

/** Status words of a position / order: closed, open, cancelled, filled … */
export function parseStatusWord(text: string): "closed" | "open" | "cancelled" | "filled" | "partial" | null {
  const f = fold(text);
  const table: ["closed" | "open" | "cancelled" | "filled" | "partial", readonly string[]][] = [
    ["closed", ["geschlossen", "closed", "beendet", "abgeschlossen", "liquidated", "liquidiert", "adl"]],
    ["open", ["offen", "open", "aktiv", "active", "laufend", "pending", "ausstehend", "new"]],
    ["cancelled", ["storniert", "cancelled", "canceled", "abgelehnt", "rejected", "expired", "abgelaufen"]],
    ["filled", ["gefullt", "filled", "ausgefuhrt", "executed", "vollstandig ausgefuhrt", "fully filled"]],
    ["partial", ["teilweise", "partially filled", "partial", "teilweise ausgefuhrt"]],
  ];
  for (const [w, list] of table) for (const p of list) if (f === p || (p.length >= 6 && distance(f, p) <= 1)) return w;
  return null;
}

/* ------------------------------------------------------------------ numbers and times as printed */

/** A number as displayed, possibly signed, grouped, with a unit: „-14.66565175“, „81,214.3“, „-4.03 %“, „+27,48 USDT“. */
export const NUMBER_RE = /^[+\-−–]?\s*\d[\d.,\s]*\d?(?:\s*(?:%|[A-Za-z]{2,6}))?$/;

export const isNumberLike = (t: string): boolean => /\d/.test(t) && NUMBER_RE.test(t.trim());

/** Date as printed (ISO, dotted, slashed, MM-DD) – used to find time cells and to join a date word with its clock word. */
export const DATE_RE = /^\d{4}[-/.]\d{1,2}[-/.]\d{1,2}$|^\d{1,2}[./]\d{1,2}[./]\d{2,4}$|^\d{1,2}-\d{1,2}$/;
export const CLOCK_RE = /^\d{1,2}[:.;]\d{2}(?:[:.;]\d{2})?$/;

export const isDateTimeLike = (t: string): boolean => /\d{1,4}[-/.]\d{1,2}[-/.]\d{1,4}/.test(t) || /\d{1,2}:\d{2}/.test(t);
