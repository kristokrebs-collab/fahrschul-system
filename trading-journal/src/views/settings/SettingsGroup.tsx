/**
 * One group of the settings page (Feinschliff, Runde 8): a quiet title with a one-line lead over a few cards, so the
 * ~9 000 px long form reads as five parts instead of sixteen loose cards. Same title language as the section heads of
 * Analyse / Wachstum (signal dot, `.label`, lead under it) – without their letter reveal: the settings page is part of
 * the first load. The cards keep their own spans: the group is a two-column grid that spans the form.
 *
 * The title is an `h2` like the cards' headings; no group title STARTS with a card heading (the section strip and the
 * function register find a card by the start of its heading).
 */
import { useId, type ReactNode } from "react";
import { cn } from "@/lib/cn";

export interface SettingsGroupProps {
  /** `data-section` – target of the page's strip */
  section: string;
  title: string;
  sub: string;
  children: ReactNode;
  className?: string;
}

export function SettingsGroup({ section, title, sub, children, className }: SettingsGroupProps) {
  const id = useId();
  return (
    <section aria-labelledby={id} data-section={section} className={cn("grid min-w-0 grid-cols-1 gap-5 lg:col-span-2 lg:grid-cols-2", className)}>
      <div className="grid min-w-0 gap-1.5 pt-6 lg:col-span-2">
        <div className="flex min-w-0 items-center gap-2">
          <span className="size-1.5 shrink-0 rounded-full bg-signal" aria-hidden="true" />
          <h2 id={id} className="label !text-fg">
            {title}
          </h2>
        </div>
        <p className="max-w-[60ch] text-[13px] text-mute">{sub}</p>
      </div>
      {children}
    </section>
  );
}
