/**
 * AnalysisNote – the one calm line at the end of every page (and sheet) that analyses, simulates or suggests: what the
 * numbers above are made of and that they are no advice ("Keine professionelle Finanzberatung."). One component, so the
 * wording is the same everywhere and a page adds it with one line. It never sits on the overview (the start page keeps
 * its own footer) and never in every bubble or card: once per page, at its end.
 *
 * Contrast: `text-mute` (≥ 4.5 : 1 on both themes; `text-faint` is only ~3 : 1 on the dark ink).
 */
import { cn } from "@/lib/cn";

/** The sentence every analysis ends with (also exported for places that need the bare text, e.g. print footers). */
export const NO_ADVICE_TEXT = "Keine professionelle Finanzberatung.";

/** What the figures are made of – the default lead of a page. */
export const ANALYSIS_BASIS = "Auswertung deiner Daten und historischer Kurse – keine Prognose.";

/** The standing line under the assistant's input field. */
export const ASSISTANT_NOTE = "Antworten rechnet die App aus deinen Daten; keine professionelle Finanzberatung.";

interface Props {
  /** replaces the first sentence where the default would not be true for the page (e.g. no price history involved) */
  lead?: string;
  /** `assistant`: the one-sentence line under the input field instead of the two sentences of a page */
  variant?: "page" | "assistant";
  /** a page built on the 12-column grid passes `lg:col-span-12`; a one-column grid or a sheet passes nothing */
  className?: string;
}

export function AnalysisNote({ lead = ANALYSIS_BASIS, variant = "page", className }: Props) {
  return (
    <p className={cn("text-[12px] leading-relaxed text-mute", variant === "page" && "max-w-[72ch]", className)} data-testid="analysis-note" data-variant={variant}>
      {variant === "assistant" ? ASSISTANT_NOTE : `${lead} ${NO_ADVICE_TEXT}`}
    </p>
  );
}
