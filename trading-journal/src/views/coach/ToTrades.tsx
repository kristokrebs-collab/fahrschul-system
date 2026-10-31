import { Button } from "@/primitives/Button";
import { navigate } from "@/store/router";

/**
 * The next step of an empty Coach card that waits for more trades: the journal, where they are entered and read. A
 * quiet secondary button (not "Trade eintragen" – that main action lives in the dock and the sidebar).
 */
export function ToTrades() {
  return (
    <Button size="sm" className="mt-2" onClick={() => navigate("trades")} data-testid="coach-to-trades">
      Zu den Trades
    </Button>
  );
}
