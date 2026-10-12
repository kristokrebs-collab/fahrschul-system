import { cn } from "@/lib/cn";
import { Button, type ButtonSize } from "@/primitives/Button";
import { communityEnabled, openShare } from "../store";
import { SHARE } from "../strings";
import { Glyph } from "./glyphs";

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
  if (props.setupId && !communityEnabled()) return null;
  const onClick = () => (props.tradeId ? openShare({ kind: "trade", tradeId: props.tradeId }) : openShare({ kind: "setup", setupId: props.setupId! }));
  return (
    <Button size={size} onClick={onClick} aria-label={iconOnly ? SHARE.button : undefined} className={cn(iconOnly && "px-2.5", className)} data-testid="share-button">
      <Glyph name="share" className="size-4" />
      {!iconOnly && SHARE.button}
    </Button>
  );
}
