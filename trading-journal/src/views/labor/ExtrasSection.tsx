/**
 * Belastung, Bericht, Filter (F20 / F18 / F17): three collapsible cards under the diagnosis. Each body is its own lazy chunk
 * and mounts on the first opening; nothing is computed before (the stress scenarios and the filter comparison start with
 * their own button). Collapsed they cost the page one header line each.
 */
import { lazy, Suspense, useId, useState, type ReactNode } from "react";
import { Button } from "@/primitives/Button";
import { Card } from "@/primitives/Card";
import { Collapse } from "@/primitives/Expander";
import { LABOR } from "./strings";

const StressBody = lazy(() => import("./StressBody"));
const ReportBody = lazy(() => import("./ReportBody"));
const FilterBody = lazy(() => import("./FilterBody"));

const X = LABOR.extras;

function ExtraCard({ id, title, sub, children }: { id: string; title: string; sub: string; children: ReactNode }) {
  const [open, setOpen] = useState(false);
  const [seen, setSeen] = useState(false);
  const region = useId();
  const toggle = (): void => {
    setSeen(true);
    setOpen((o) => !o);
  };
  return (
    <Card
      title={title}
      note={sub}
      data-testid={`labor-extra-${id}`}
      data-open={open ? "true" : "false"}
      action={
        <Button size="sm" onClick={toggle} aria-expanded={open} aria-controls={region} aria-label={`${title}: ${open ? X.close : X.open}`} data-testid={`labor-extra-toggle-${id}`}>
          {open ? X.close : X.open}
        </Button>
      }
    >
      <Collapse open={open} id={region}>
        <div className="pt-1">
          {seen && (
            <Suspense
              fallback={
                <p className="text-[12.5px] text-mute" role="status">
                  {X.loading}
                </p>
              }
            >
              {children}
            </Suspense>
          )}
        </div>
      </Collapse>
    </Card>
  );
}

export function ExtrasSection() {
  return (
    <div className="grid gap-4" data-testid="labor-extras">
      <ExtraCard id="stress" title={X.stress.title} sub={X.stress.sub}>
        <StressBody />
      </ExtraCard>
      <ExtraCard id="report" title={X.report.title} sub={X.report.sub}>
        <ReportBody />
      </ExtraCard>
      <ExtraCard id="filters" title={X.filters.title} sub={X.filters.sub}>
        <FilterBody />
      </ExtraCard>
    </div>
  );
}

export default ExtrasSection;
