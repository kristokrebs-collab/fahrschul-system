/**
 * The smaller parts of the sidebar (Runde 11, A5): the foot buttons, the search at the top, the night-mode switch, the user card and the
 * nested entries under „Einstellungen“. They live here so `Sidebar.tsx` stays the one place for the frame, the marker and the peek.
 *
 * Every part is ONE element that is 48 px wide in the rail and as wide as the panel once it is open (`.sb-row` / `.sb-search` in
 * `shell-motion.css`): the clip of the aside reveals it on the spring, nothing is swapped or re-laid out per frame, and keyboard focus never
 * lands on something that disappears when the panel opens.
 */
import { useEffect, useState, type ButtonHTMLAttributes, type CSSProperties, type MouseEvent, type ReactNode } from "react";
import { SETTINGS_SECTIONS } from "@/app/navGroups";
import { revealSection } from "@/app/reveal";
import { PLAN_CATALOG } from "@/billing/plans";
import { useEffectivePlan } from "@/billing/store";
import { cloudEnabled } from "@/cloud/env";
import { useCloudSession } from "@/cloud/session";
import { cn } from "@/lib/cn";
import { useMotionTier } from "@/motion/tier";
import { Icon } from "@/primitives/icons";
import { SearchField, type SearchOption } from "@/primitives/SearchField";
import { navigate } from "@/store/router";
import { toggleTheme, useTheme } from "@/store/themeStore";

export const ROW_TAIL = "outline-none transition-colors duration-200 hover:bg-white/[0.05] focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-white";

export const SIDEBAR_PART_STRINGS = {
  search: "Seiten und Funktionen suchen",
  searchPlaceholder: "Seiten suchen",
  searching: "Suche …",
  none: "Dazu steht nichts in der Liste.",
  hits: "Treffer",
  night: "Nachtmodus",
  account: "Konto",
  local: "Nur auf diesem Gerät",
  device: "Dieses Gerät",
  fresh: "Neu",
  nested: "Abschnitte der Einstellungen",
} as const;

/** A foot button of the rail (Rechtliches, Nachtmodus, Anheften): the icon stays where the rail's icons are, the word comes with the peek. */
export function FootButton({ index, icon, word, trail, ...props }: { index: number; icon: ReactNode; word: string; trail?: ReactNode } & ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button type="button" {...props} className={cn("sb-row flex h-11 items-center gap-3 rounded-xl px-2.5 text-mute hover:text-fg", ROW_TAIL, props.className)}>
      {icon}
      <span aria-hidden="true" className="sb-lbl min-w-0 flex-1 truncate text-left text-[12.5px] font-medium" style={{ "--i": index } as CSSProperties}>
        {word}
      </span>
      {trail}
    </button>
  );
}

const ICON_CELL = "grid size-7 shrink-0 place-items-center [&>svg]:size-[18px]";

/* ------------------------------------------------------------------ search */

/**
 * „Seiten suchen“ at the top: the shared `SearchField` (size `sm`, answers as a popover over the rows). Pages AND functions answer, from the
 * register's lazy chunk that is fetched with the first typed letter (the same lookup as the navigation's finder). In the rail the field is its 48 px
 * glass tile with the magnifier; a click or the keyboard focus opens the panel (the peek) and the field with it.
 */
export function SidebarSearch() {
  const [q, setQ] = useState("");
  const query = q.trim();
  const [found, setFound] = useState<{ done: string; options: SearchOption[] }>({ done: "", options: [] });
  useEffect(() => {
    if (!query) return;
    let live = true;
    void import("@/app/navFinderHits").then((m) => {
      if (live) setFound({ done: query, options: m.findHits(query).slice(0, 6).map(m.toOption) });
    });
    return () => {
      live = false;
    };
  }, [query]);
  const ready = found.done === query;
  return (
    <div className="sb-search">
      <SearchField
        testId="sidebar-search"
        size="sm"
        label={SIDEBAR_PART_STRINGS.search}
        labelHidden
        placeholder={SIDEBAR_PART_STRINGS.searchPlaceholder}
        value={q}
        onChange={setQ}
        options={ready ? found.options : []}
        listMode="popover"
        listLabel={SIDEBAR_PART_STRINGS.hits}
        status={query && !ready ? SIDEBAR_PART_STRINGS.searching : undefined}
        empty={ready ? <p className="px-3.5 py-3 text-[12.5px] leading-relaxed text-mute">{SIDEBAR_PART_STRINGS.none}</p> : null}
        onSelect={(id) => {
          setQ("");
          void import("@/app/featureOpen").then((m) => m.openFeature(id));
        }}
      />
    </div>
  );
}

/* ------------------------------------------------------------------ night mode */

/** The night-mode switch: `role="switch"`, the circular reveal of the theme change starts at the button. */
export function NightRow({ index }: { index: number }) {
  const dark = useTheme((s) => s.resolved) === "dark";
  const onClick = (e: MouseEvent<HTMLButtonElement>) => {
    const r = e.currentTarget.getBoundingClientRect();
    toggleTheme({ x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) });
  };
  return (
    <FootButton
      index={index}
      word={SIDEBAR_PART_STRINGS.night}
      role="switch"
      aria-checked={dark}
      aria-label={SIDEBAR_PART_STRINGS.night}
      data-testid="sidebar-night"
      onClick={onClick}
      icon={
        <span aria-hidden="true" className={ICON_CELL}>
          <Icon name="moon" />
        </span>
      }
      trail={
        <span aria-hidden="true" className="sb-lbl relative h-[18px] w-[30px] shrink-0 rounded-full border border-line-2 bg-white/[0.05] transition-colors duration-200 data-[on]:bg-fg" data-on={dark ? "" : undefined} style={{ "--i": index } as CSSProperties}>
          <span className={cn("absolute left-[2px] top-[2px] size-3 rounded-full bg-mute transition-[translate,background-color] duration-200", dark && "translate-x-3 !bg-ink-950")} />
        </span>
      }
    />
  );
}

/* ------------------------------------------------------------------ user card */

/**
 * The reader at the foot: initial, the name the account goes by and what this device does with the data – a button to the page Konto. Team
 * plans get a ring around the avatar and a small „Team“ chip that rises in when the plan changes (`[data-motion-tier="team"]`). Honest: no
 * account → „Nur auf diesem Gerät“; the plan is the server-confirmed one (`useEffectivePlan`).
 */
export function UserCard({ index, current }: { index: number; current: boolean }) {
  const phase = useCloudSession((s) => s.phase);
  const email = useCloudSession((s) => s.user?.email ?? null);
  const plan = useEffectivePlan().plan;
  const tier = useMotionTier();
  const signedIn = cloudEnabled() && phase === "signedIn";
  const name = signedIn && email ? (email.split("@")[0] ?? email) : SIDEBAR_PART_STRINGS.device;
  const sub = signedIn ? PLAN_CATALOG[plan].name : SIDEBAR_PART_STRINGS.local;
  const initial = signedIn && email ? email.slice(0, 1).toUpperCase() : "";
  return (
    <button
      type="button"
      onClick={() => navigate("konto")}
      aria-label={`${SIDEBAR_PART_STRINGS.account}: ${name}, ${sub}`}
      aria-current={current ? "page" : undefined}
      data-testid="sidebar-user"
      className={cn("sb-row flex h-12 items-center gap-3 rounded-xl px-2.5 text-left text-fg", ROW_TAIL)}
    >
      <span aria-hidden="true" className={cn("relative grid size-7 shrink-0 place-items-center rounded-full border border-line-2 bg-white/[0.06] text-[12px] font-semibold uppercase", tier === "team" && "ring-2 ring-signal/50 ring-offset-1 ring-offset-transparent")}>
        {initial || <Icon name="user" className="size-4" />}
      </span>
      <span className="sb-lbl grid min-w-0 flex-1" style={{ "--i": index } as CSSProperties}>
        <span className="truncate text-[13px] font-medium leading-tight">{name}</span>
        <span className="truncate text-[11px] leading-tight text-mute">{sub}</span>
      </span>
      {signedIn && tier && tier !== "free" && (
        <span key={tier} aria-hidden="true" className="sb-lbl shrink-0 rounded-full border border-line-2 px-1.5 text-[10px] font-semibold uppercase leading-4 tracking-[0.08em] text-mute" style={{ "--i": index } as CSSProperties}>
          {PLAN_CATALOG[plan].name}
        </span>
      )}
    </button>
  );
}

/* ------------------------------------------------------------------ nested entries */

/**
 * The sections of the page Einstellungen as nested entries under its row – only while the sidebar is PINNED open (a peek that grew the list would
 * push the rows under the pointer away) and only on that page. A tap scrolls the section under the header (`revealSection`, the same as the page's strip).
 */
export function SettingsEntries({ visible }: { visible: boolean }) {
  return (
    <div className="grid transition-[grid-template-rows] [transition-duration:var(--sb-ms)] [transition-timing-function:var(--sb-ease)]" style={{ gridTemplateRows: visible ? "1fr" : "0fr" }} data-testid="sidebar-sub">
      <ul inert={!visible} aria-label={SIDEBAR_PART_STRINGS.nested} className="m-0 min-h-0 list-none overflow-hidden pl-[26px]">
        {SETTINGS_SECTIONS.map((s) => (
          <li key={s.id}>
            <button
              type="button"
              data-sub={s.id}
              onClick={() => {
                const el = document.querySelector<HTMLElement>(`[data-section="${s.id}"]`);
                if (el) revealSection(el);
              }}
              className={cn("flex h-11 w-full items-center gap-2.5 rounded-xl pl-3 pr-2 text-left text-[12.5px] text-mute hover:text-fg", ROW_TAIL)}
            >
              <span aria-hidden="true" className="size-1 shrink-0 rounded-full bg-current opacity-60" />
              <span className="truncate">{s.label}</span>
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}

/** Pure: the sub-entries show for the current page `settings` when the sidebar is pinned. */
export const showSettingsEntries = (page: string, pinned: boolean): boolean => pinned && page === "settings";
