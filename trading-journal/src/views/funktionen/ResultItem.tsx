import { motion } from "motion/react";
import type { ReactNode } from "react";
import { useRichFx } from "@/motion/rich";
import { radius, spring, tween } from "@/motion/tokens";

/**
 * One row of the search results. On a rich page the list is alive while the query changes: a row that is new fades in,
 * rows that stay glide to their new place (`layout="position"` – it never scales its content). Rows that leave are gone
 * at once (no exit animation), so the list the person types into always shows exactly what matches. Elsewhere, and under
 * reduced motion, a plain `li`.
 */
export function ResultItem({ children }: { children: ReactNode }) {
  const fx = useRichFx();
  if (!fx) return <li className="min-w-0">{children}</li>;
  return (
    <motion.li
      layout="position"
      style={{ borderRadius: radius.card }}
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0, transitionEnd: { transform: "none" } }}
      transition={{ layout: spring.layout, opacity: tween.fade, y: spring.enter }}
      className="min-w-0"
    >
      {children}
    </motion.li>
  );
}
