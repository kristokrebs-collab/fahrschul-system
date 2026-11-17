/**
 * Versionen und Playbooks (F15 / F13 / F45): the versions of the saved drafts and the playbook exchange. Its own lazy chunk –
 * the version diff and the playbook reader load only when the section is on the page.
 */
import { PlaybookCard } from "./PlaybookCard";
import { VersionsCard } from "./VersionsCard";

export function DraftsSection() {
  return (
    <div className="grid grid-cols-1 gap-4" data-testid="labor-drafts-section">
      <VersionsCard />
      <PlaybookCard />
    </div>
  );
}

export default DraftsSection;
