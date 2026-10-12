/**
 * A page whose plan feature is locked (P14, `PageGate` fallback – only while payments are open and the plan lacks the
 * feature): the page's own header (`h1` + what it does) and the P10 `UpgradeTeaser` with the way to the plan. Lazy
 * chunk: a trader who never meets a locked page never downloads it.
 */
import { PAGE_LABELS } from "@/app/Dock";
import { FEATURE_INFO } from "@/billing/plans";
import type { Feature } from "@/billing/types";
import { UpgradeTeaser } from "@/billing/ui/UpgradeTeaser";
import { Reveal } from "@/motion/Reveal";
import type { Page } from "@/store/uiStore";
import { PageHeader } from "@/views/setups/PageHeader";

export default function LockedPage({ page, feature }: { page: Page; feature: Feature }) {
  return (
    <div className="grid grid-cols-1 gap-5 lg:grid-cols-12" data-testid="locked-page" data-feature={feature}>
      <PageHeader className="lg:col-span-12" title={PAGE_LABELS[page]} lead={FEATURE_INFO[feature].pitch} />
      <Reveal index={0} className="min-w-0 lg:col-span-8">
        <UpgradeTeaser feature={feature} />
      </Reveal>
    </div>
  );
}
