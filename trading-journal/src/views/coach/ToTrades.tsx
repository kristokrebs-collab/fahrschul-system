import { Button } from "@/primitives/Button";
import { navigate } from "@/store/router";

/**
 * The next step of an empty Coach card that waits for more trades: the journal, where they are entered and read. A
 * quiet secondary button (not "Trade eintragen" – that main action lives in the dock and the sidebar).
 */
export function ToTrades() {
  return (
    // in a span: as a direct child of the empty state's action slot the button would be clipped (`overflow-hidden` for the
    // one-off sheen) – and with it its 44 px tap area
    <span className="mt-2 inline-flex">
      <Button size="sm" onClick={() => navigate("trades")} data-testid="coach-to-trades">
        Zu den Trades
      </Button>
    </span>
  );
}
