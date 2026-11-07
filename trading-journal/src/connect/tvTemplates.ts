/**
 * Copy-ready templates for the TradingView alert (Paket Verbindungen). They are EXAMPLES of the message format of
 * `hooks-tradingview.mts` – not trading signals. `{{…}}` are TradingView placeholders, filled by TradingView when the
 * alert fires.
 */

/** Test: creates no trade, only shows up in the receipt list. */
export const TV_TEST_MESSAGE = `{"action":"test","symbol":"{{ticker}}"}`;

/** Trade alerts: need the plan feature "API & Webhooks"; an entry needs a size (`qty`), else no profit can be computed. */
export const TV_OPEN_MESSAGE = `{"action":"open","symbol":"{{ticker}}","side":"long","price":{{close}},"qty":{{strategy.order.contracts}},"timeframe":"{{interval}}"}`;
export const TV_CLOSE_MESSAGE = `{"action":"close","symbol":"{{ticker}}","side":"long","price":{{close}}}`;

/** A small Pine v6 indicator whose alert condition posts the entry message – a starting point to adapt, not advice. */
export const TV_PINE = `//@version=6
indicator("Journal-Signal (Beispiel)", overlay = true)
fast = ta.sma(close, 20)
slow = ta.sma(close, 50)
longCross = ta.crossover(fast, slow)
plot(fast, "SMA 20")
plot(slow, "SMA 50")
// Alarm anlegen: Bedingung "Journal: Long", Benachrichtigung "Webhook-URL"
alertcondition(longCross, title = "Journal: Long", message = '{"action":"open","symbol":"{{ticker}}","side":"long","price":{{close}},"qty":1,"timeframe":"{{interval}}"}')`;

/** The test body the "Testsignal senden" button posts from this app. */
export const TV_APP_TEST_BODY = `{"action":"test","symbol":"TEST","source":"app"}`;

/** Webhook address from the plain token (the origin is the operator's `SITE_ORIGIN` when the server reports one). */
export function webhookUrl(token: string, serverOrigin: string | null, pageOrigin: string): string {
  const origin = (serverOrigin ?? pageOrigin).replace(/\/+$/, "");
  return `${origin}/api/v1/hooks/tradingview/${token}`;
}

/** Address with the secret part hidden for display (`…/tradingview/tj_AbCd••••`). */
export function maskedUrl(url: string): string {
  return url.replace(/(\/tradingview\/tj_[A-Za-z0-9_-]{4})[A-Za-z0-9_-]+/, "$1••••••••");
}

/** signal/1: direction only, never an order size (`netlify/functions/_lib/signals/schema.ts`). `signalId` must be unique per signal: ticker + interval + bar time. */
export const TV_SIGNAL_MESSAGE = `{"schema":"signal/1","source":"tradingview","signalId":"{{ticker}}-{{interval}}-{{time}}","strategy":"MEINE-STRATEGIE","market":"{{exchange}}","symbol":"{{ticker}}","direction":"long","time":"{{time}}"}`;
export const TV_SIGNAL_FLAT_MESSAGE = `{"schema":"signal/1","source":"tradingview","signalId":"{{ticker}}-{{interval}}-{{time}}","strategy":"MEINE-STRATEGIE","market":"{{exchange}}","symbol":"{{ticker}}","direction":"flat","time":"{{time}}"}`;

/** A small Pine v6 indicator whose alerts post signal/1 (long on the crossover, flat on the crossunder). A starting point, not advice. */
export const TV_PINE_SIGNAL = `//@version=6
indicator("Journal-Signal v1 (Beispiel)", overlay = true)
// Webhook-URL gehört in den ALARM (Benachrichtigungen), nicht in diesen Code: <Seite>/api/v1/signals/DEIN-TOKEN
fast = ta.sma(close, 20)
slow = ta.sma(close, 50)
goLong = ta.crossover(fast, slow)
goFlat = ta.crossunder(fast, slow)
plot(fast, "SMA 20")
plot(slow, "SMA 50")
alertcondition(goLong, title = "Journal: Signal long", message = '${TV_SIGNAL_MESSAGE}')
alertcondition(goFlat, title = "Journal: Signal flat", message = '${TV_SIGNAL_FLAT_MESSAGE}')`;

/** The address that takes ONLY signals (no journal trade): with the real token when this session knows it, else a placeholder. */
export function signalsUrl(webhook: string | null, serverOrigin: string | null, pageOrigin: string): string {
  const m = webhook ? /^(https?:\/\/[^/]+)\/api\/v1\/hooks\/tradingview\/(tj_[A-Za-z0-9_-]+)$/.exec(webhook) : null;
  if (m) return `${m[1]}/api/v1/signals/${m[2]}`;
  return `${(serverOrigin ?? pageOrigin).replace(/\/+$/, "")}/api/v1/signals/DEIN-TOKEN`;
}
