/**
 * Test helper: fills the TradingView placeholders of a message template the way TradingView does (numbers stay numbers,
 * text placeholders become quoted text already in the template) and parses the result as JSON.
 */
export function tvTemplatesAreJson(templates: readonly string[]): unknown[] {
  const fill: Record<string, string> = {
    "{{ticker}}": "BTCUSDT",
    "{{close}}": "1",
    "{{strategy.order.contracts}}": "1",
    "{{interval}}": "1",
  };
  return templates.map((t) => JSON.parse(Object.entries(fill).reduce((acc, [k, v]) => acc.split(k).join(v), t)) as unknown);
}
