/**
 * Cockpit page (P13). The integrator registers `CockpitView` as page `cockpit` (lazy, `h1 Cockpit`); other packages
 * add widgets with `registerWidget({ id, title, component, defaultSpan })`. See README.md.
 */
export { CockpitView, SPAN_CLASS, spanRules } from "./CockpitView";
export { registerWidget, registerWidgets, getWidget, listWidgets, useRegistryVersion, snapSpan, SPANS, type CockpitWidget, type Span } from "./registry";
export { registerBuiltinWidgets, OVERVIEW_WIDGETS, INSIGHT_WIDGETS, GROUPS } from "./builtins";
export { useCockpit, cockpit, parseCockpit, defaultData, DEFAULT_BOARDS, COCKPIT_KEY, MAX_BOARDS, type Board, type BoardItem, type CockpitData } from "./cockpitStore";
export { COCKPIT_STRINGS, COCKPIT_LEAD_FILL } from "./copy";
export { WidgetCatalog, filterWidgets } from "./WidgetCatalog";
