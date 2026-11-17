import { cloudEnabled } from "@/cloud/env";
import { cn } from "@/lib/cn";
import { Button, type ButtonSize } from "@/primitives/Button";
import { hasClaudeRuntime } from "@/store/capability";
import type { ShareTarget } from "../store";
import { SHARE_BUTTON } from "../buttonStrings";
import { Glyph } from "./glyphs";

/**
 * Opens the share sheet. The community store (API, groups, goals) is imported on the press, not with the button: the
 * button sits in the trade detail and on the setup cards (first load, P14); the sheet's host (`SocialHost`, a lazy
 * app host) has loaded the store long before, so the import resolves at once.
 */
function share(target: ShareTarget): void {
  void import("../store").then((m) => m.openShare(target));
}

export type ShareButtonProps = ({ tradeId: string; setupId?: never } | { setupId: string; tradeId?: never }) & {
  size?: ButtonSize;
  /** Icon only (the accessible name stays "Teilen"). */
  iconOnly?: boolean;
  className?: string;
};

/**
 * "Teilen" (P12) – opens the share sheet (`SocialHost`) for a trade or an Entscheidungsgrundlage. A trade can always be
 * shared as a picture (no cloud needed); a setup only as a link, so the button hides itself for setups without cloud.
 * P14 wiring: `TradeDetail` → `<ShareButton tradeId={t.id} />`, setup card → `<ShareButton setupId={s.id} />`.
 */
export function ShareButton(props: ShareButtonProps) {
  const { size = "sm", iconOnly = false, className } = props;
  // = `communityEnabled()` of the store (a link needs the cloud; a trade can always be shared as a picture)
  if (props.setupId && !(cloudEnabled() && !hasClaudeRuntime())) return null;
  const onClick = () => (props.tradeId ? share({ kind: "trade", tradeId: props.tradeId }) : share({ kind: "setup", setupId: props.setupId! }));
  return (
    <Button size={size} onClick={onClick} aria-label={iconOnly ? SHARE_BUTTON : undefined} className={cn(iconOnly && "px-2.5", className)} data-testid="share-button">
      <Glyph name="share" className="size-4" />
      {!iconOnly && SHARE_BUTTON}
    </Button>
  );
}
