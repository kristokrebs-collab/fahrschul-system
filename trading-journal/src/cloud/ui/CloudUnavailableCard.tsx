import { motion } from "motion/react";
import { IS_FILE_BUILD, isFileProtocol } from "@/edition";
import { DotMatrix, type DotFrame } from "@/motion";
import { tween } from "@/motion/tokens";
import { useReducedFx } from "@/motion/useReducedFx";
import { Card } from "@/primitives/Card";
import { hasClaudeRuntime } from "@/store/capability";
import { KONTO } from "./strings";

/** A dot-matrix cloud, struck through (static frame). */
const o = 0.42;
export const CLOUD_OFF: DotFrame = [
  [0, 0, 0, o, o, o, 0, 0, 1],
  [0, 0, o, 0, 0, 0, o, 1, 0],
  [0, o, 0, 0, 0, 0, 1, 0, o],
  [o, 0, 0, 0, 0, 1, 0, 0, o],
  [o, 0, 0, 0, 1, 0, 0, 0, o],
  [0, o, o, 1, o, o, o, o, 0],
  [0, 0, 1, 0, 0, 0, 0, 0, 0],
];

/**
 * Honest state when the cloud is not configured (P09): no fake login. File builds / file:// say so; claude.ai points to
 * its own sync; a web build without the Supabase variables names them for the operator (small print). The dot matrix
 * shows a struck-through cloud (static frame – nothing loops).
 */
export function CloudUnavailableCard({ className }: { className?: string }) {
  const reduced = useReducedFx();
  const file = IS_FILE_BUILD || isFileProtocol();
  const claude = hasClaudeRuntime();
  return (
    <Card title={KONTO.unavailableTitle} className={className}>
      <div className="flex flex-col gap-5 sm:flex-row sm:items-center">
        <motion.div className="shrink-0" initial={reduced ? false : { opacity: 0, scale: 0.92 }} animate={{ opacity: 1, scale: 1, transitionEnd: { transform: "none" } }} transition={tween.reveal}>
          <DotMatrix pattern={CLOUD_OFF} size={5} gap={2.5} tone="fg" glow={false} label="Cloud aus" />
        </motion.div>
        <div className="grid gap-2">
          <p className="text-[13.5px] leading-relaxed text-fg">{file ? KONTO.unavailableFile : claude ? KONTO.unavailableClaude : KONTO.unavailableText}</p>
          {!file && !claude && <p className="font-mono text-[11px] leading-relaxed text-faint">{KONTO.unavailableOwner}</p>}
        </div>
      </div>
    </Card>
  );
}
