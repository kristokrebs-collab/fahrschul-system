import { AnimatePresence, motion } from "motion/react";
import { useEffect, useId, useMemo, useState, type KeyboardEvent } from "react";
import { cn } from "@/lib/cn";
import { TextRoll } from "@/motion/TextRoll";
import { radius, spring, tween } from "@/motion/tokens";
import { useReducedFx } from "@/motion/useReducedFx";

export const MAX_TAGS = 12;
export const MAX_TAG_LENGTH = 32;

/** Normalises a typed tag: trimmed, inner whitespace collapsed, leading `#` dropped, capped. */
export function cleanTag(raw: string): string {
  return raw.trim().replace(/^#+/, "").replace(/\s+/g, " ").trim().slice(0, MAX_TAG_LENGTH);
}

/** Adds `tag` (case-insensitive unique, at most `MAX_TAGS`). */
export function addTag(list: readonly string[], raw: string): string[] {
  const tag = cleanTag(raw);
  if (!tag || list.length >= MAX_TAGS || list.some((t) => t.toLowerCase() === tag.toLowerCase())) return [...list];
  return [...list, tag];
}

/** Tags used in the journal, most used first (ties alphabetical). */
export function tagSuggestions(trades: readonly { tags?: readonly string[] }[]): string[] {
  const count = new Map<string, number>();
  for (const t of trades) for (const tag of t.tags ?? []) count.set(tag, (count.get(tag) ?? 0) + 1);
  return [...count.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0], "de")).map(([t]) => t);
}

/** A label that morphs in letter by letter after mount (`TextRoll` morph from empty). */
function MorphIn({ text }: { text: string }) {
  const [shown, setShown] = useState("");
  useEffect(() => {
    const id = requestAnimationFrame(() => setShown(text));
    return () => cancelAnimationFrame(id);
  }, [text]);
  return <TextRoll text={shown || " "} mode="morph" />;
}

export interface TagInputProps {
  value: readonly string[];
  onChange: (tags: string[]) => void;
  /** Journal tags offered below the field. */
  suggestions?: readonly string[];
  label?: string;
  className?: string;
}

/**
 * Free tags of a trade: chips (each morphs in with `TextRoll`, pops on `spring.pop`, leaves on `tween.exit`; tap = remove)
 * plus a field (Enter / Komma adds, Backspace on an empty field removes the last chip) and the journal's tags as quick
 * picks. Accessible: the chips are buttons named `Tag „x“ entfernen`; the field has its own label.
 */
export function TagInput({ value, onChange, suggestions = [], label = "Tags", className }: TagInputProps) {
  const reduced = useReducedFx();
  const id = useId();
  const [draft, setDraft] = useState("");
  const picks = useMemo(() => {
    const q = cleanTag(draft).toLowerCase();
    const taken = new Set(value.map((t) => t.toLowerCase()));
    return suggestions.filter((s) => !taken.has(s.toLowerCase()) && (!q || s.toLowerCase().includes(q))).slice(0, 8);
  }, [suggestions, value, draft]);
  const full = value.length >= MAX_TAGS;

  const commit = (raw = draft) => {
    const next = addTag(value, raw);
    setDraft("");
    if (next.length !== value.length) onChange(next);
  };
  const onKey = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter" || e.key === ",") {
      e.preventDefault();
      commit();
    } else if (e.key === "Backspace" && !draft && value.length) {
      onChange(value.slice(0, -1));
    }
  };

  return (
    <div className={cn("grid gap-2", className)}>
      <div className="flex flex-wrap items-center gap-1.5" role="group" aria-label={label}>
        <AnimatePresence initial={false}>
          {value.map((tag) => (
            <motion.button
              key={tag}
              type="button"
              layout="position"
              aria-label={`Tag „${tag}“ entfernen`}
              onClick={() => onChange(value.filter((t) => t !== tag))}
              initial={reduced ? false : { opacity: 0, scale: 0.7 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.8, transition: tween.exit }}
              transition={{ scale: spring.pop, opacity: tween.fade, layout: spring.layout }}
              whileTap={reduced ? undefined : { scale: 0.94 }}
              style={{ borderRadius: radius.pill }}
              className="group inline-flex items-center gap-1.5 border border-white/25 bg-white/[0.07] px-2.5 py-1 text-[12px] font-medium text-fg transition-colors hover:border-loss/50 pointer-coarse:min-h-11"
            >
              <span className="text-faint" aria-hidden="true">
                #
              </span>
              <span aria-hidden="true">{reduced ? tag : <MorphIn text={tag} />}</span>
              <span aria-hidden="true" className="text-faint transition-colors group-hover:text-loss">
                ×
              </span>
            </motion.button>
          ))}
        </AnimatePresence>
        <label htmlFor={`${id}-tag`} className="sr-only">
          Neuer Tag
        </label>
        <input
          id={`${id}-tag`}
          value={draft}
          disabled={full}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={onKey}
          onBlur={() => draft.trim() && commit()}
          placeholder={full ? `Höchstens ${MAX_TAGS} Tags` : value.length ? "+ Tag" : "Tag eingeben, Enter"}
          maxLength={MAX_TAG_LENGTH + 2}
          autoComplete="off"
          className="h-8 min-w-[9rem] flex-1 rounded-full border border-dashed border-line-2 bg-transparent px-3 text-[12.5px] text-fg outline-none placeholder:text-faint focus:border-white/40 disabled:opacity-50 pointer-coarse:h-11"
        />
      </div>
      {picks.length > 0 && !full && (
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="label !text-[9.5px]">Vorschläge</span>
          {picks.map((s) => (
            <button
              key={s}
              type="button"
              onClick={() => commit(s)}
              className="rounded-full border border-line px-2.5 py-0.5 text-[11.5px] text-mute transition-colors hover:border-white/30 hover:text-fg pointer-coarse:min-h-11"
            >
              #{s}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
