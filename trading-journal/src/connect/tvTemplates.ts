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
