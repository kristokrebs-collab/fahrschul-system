/**
 * The lazy chunk of the purchase flow (B4, Paket V): payment window (it replaced the order sheet), tariff detail, management sheet and the
 * result page. `BillingHost`
 * mounts it the first time one of them is asked for (`order.loaded`) – never with the first screen.
 */
import { ResultView } from "@/views/preise/ResultView";
import { ManageSheet } from "./ManageSheet";
import { PayWindow } from "./PayWindow";
import { TariffDetailSheet } from "./TariffDetailSheet";

export default function PurchaseHost({ onNavigate }: { onNavigate?: (page: "preise" | "konto") => void }) {
  return (
    <>
      <PayWindow />
      <TariffDetailSheet onNavigate={onNavigate} />
      <ManageSheet />
      <ResultView />
    </>
  );
}
