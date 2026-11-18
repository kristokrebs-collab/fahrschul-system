import { motion } from "motion/react";
import { useId, useState } from "react";
import { RevealGroup, RevealItem } from "@/motion/Reveal";
import { spring } from "@/motion/tokens";
import { useReducedFx } from "@/motion/useReducedFx";
import { Card } from "@/primitives/Card";
import { Collapse } from "@/primitives/Expander";
import { FAQ, PREISE } from "./strings";

/** FAQ (P10): rows cascade in (`RevealGroup`), an answer springs open (`Collapse`) while its `+` turns 45° (`spring.plus`). */
export function PricingFaq({ className }: { className?: string }) {
  const reduced = useReducedFx();
  const [open, setOpen] = useState<number | null>(null);
  const base = useId();
  return (
    <Card title={PREISE.faqTitle} className={className}>
      <RevealGroup as="ul" className="grid" data-testid="pricing-faq">
        {FAQ.map((item, i) => {
          const id = `${base}-faq-${i}`;
          const isOpen = open === i;
          return (
            <RevealItem as="li" key={item.q} className="border-b border-line/70 last:border-b-0">
              <button
                type="button"
                className="flex w-full items-center gap-3 py-3.5 text-left"
                aria-expanded={isOpen}
                aria-controls={id}
                onClick={() => setOpen(isOpen ? null : i)}
              >
                <span className="min-w-0 flex-1 text-[14px] font-medium">{item.q}</span>
                <motion.span
                  aria-hidden="true"
                  className="grid size-7 shrink-0 place-items-center rounded-full border border-line-2 text-mute"
                  animate={{ rotate: isOpen ? 45 : 0 }}
                  transition={reduced ? { duration: 0 } : spring.plus}
                >
                  <svg viewBox="0 0 16 16" className="size-3.5" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round">
                    <path d="M8 3v10M3 8h10" />
                  </svg>
                </motion.span>
              </button>
              <Collapse open={isOpen} id={id}>
                <p className="max-w-[70ch] pb-4 text-[13.5px] leading-relaxed text-mute">{item.a}</p>
              </Collapse>
            </RevealItem>
          );
        })}
      </RevealGroup>
    </Card>
  );
}
