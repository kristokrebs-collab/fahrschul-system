import { CreateGroupSheet, JoinSheet } from "./GroupSheets";
import { GoalSheet } from "./MentorDesk";
import { TradePicker } from "./ReviewFeed";

/**
 * The Community page's sheets, mounted ONCE at the page root (P12): a `Sheet` is `position: fixed` without a portal,
 * so inside a card it would take the card's hover transform as its containing block. Opened through the store
 * (`openSheet({ kind })`); the join sheet also opens by itself for an invitation from the URL.
 */
export function CommunitySheets() {
  return (
    <>
      <CreateGroupSheet />
      <JoinSheet />
      <TradePicker />
      <GoalSheet />
    </>
  );
}
