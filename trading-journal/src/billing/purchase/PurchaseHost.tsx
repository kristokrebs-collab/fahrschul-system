/**
 * The lazy chunk of the purchase flow (B4): order sheet, tariff detail, management sheet and the result page. `BillingHost`
 * mounts it the first time one of them is asked for (`order.loaded`) – never with the first screen.
 */
import { ResultView } from "@/views/preise/ResultView";
import { ManageSheet } from "./ManageSheet";
import { OrderSheet } from "./OrderSheet";
import { TariffDetailSheet } from "./TariffDetailSheet";

export default function PurchaseHost({ onNavigate }: { onNavigate?: (page: "preise" | "konto") => void }) {
  return (
    <>
      <OrderSheet />
      <TariffDetailSheet onNavigate={onNavigate} />
      <ManageSheet />
      <ResultView />
    </>
  );
}
