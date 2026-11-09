/**
 * Global search (P13). Mount `<GlobalSearchHost/>` once in `App`; open with `openSearch()` (the shortcut host binds
 * `/` and ⌘⇧F / Ctrl+⇧F). The overlay and the index are lazy (their own chunk). See README.md.
 */
export { GlobalSearchHost, preloadSearch } from "./GlobalSearchHost";
export { openSearch, closeSearch, toggleSearch, useSearchOpen, useSearch, SEARCH_RECENT_KEY } from "./searchStore";
export { buildSearchIndex, setupStats, KIND_LABEL, COMMANDS, SETTING_SECTIONS, FALLBACK_PAGE_LABELS, type SearchItem, type SearchKind, type SearchAction, type CommandId } from "./sources";
export { searchIndex, suggestions, flatHits, type SearchGroup, type SearchHit } from "./rank";
export { fold, normalize, tokenize, matchText, scoreFields, haystack, mergeRanges, digraphFold, type MatchRange } from "./fuzzy";
