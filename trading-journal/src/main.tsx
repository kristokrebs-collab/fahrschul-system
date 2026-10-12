import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "./styles/base.css";
import "./styles/themes.css";
import App from "./App";
import { installE2eHooks } from "@/app/e2eHooks";
import { bootMarket } from "@/app/marketBoot";
import { installThemeTransition } from "@/app/themeTransition";
import { MotionRoot } from "@/motion/MotionRoot";
import { bootJournal, useJournal } from "@/store/journalStore";
import { installRouter } from "@/store/router";
import { applyInitialTheme, useTheme } from "@/store/themeStore";
import { useUi } from "@/store/uiStore";

// Theme (P13) before anything paints: data-theme / accent / color-scheme / metas from localStorage, synchronously – the
// CSP allows no inline script, so this is the earliest point. Dark (the default) only sets the attributes.
applyInitialTheme();
installThemeTransition();

// Font hints: the numerals (Doto) and the mono axis font are needed for the first paint of the hero /
// charts; requesting them early avoids a late swap (Plan 9.4). Fire-and-forget, never blocks; a blocked font host
// (offline file, egress filter) rejects the load, which is caught here instead of surfacing as an unhandled NetworkError.
try {
  const fonts = (document as Document & { fonts?: FontFaceSet }).fonts;
  for (const font of ['800 1em "Doto"', '500 11px "IBM Plex Mono"', '600 14px "IBM Plex Sans"']) {
    fonts?.load(font)?.catch(() => undefined);
  }
} catch {
  /* no Font Loading API */
}

// Start sequence (Plan 1.5): migrate + hydrate synchronously, then probe claude.ai; the router needs the
// setup ids for `#trades?setup=…`, the market provider needs `settings.market.symbol`.
void bootJournal();
installRouter();
bootMarket();
// e2e only (flag set by the Playwright seed, `src/app/e2eHooks.ts`): the stores the specs read and write
installE2eHooks({ __tjJournal: useJournal, __tjUi: useUi, __tjTheme: useTheme });

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <MotionRoot>
      <App />
    </MotionRoot>
  </StrictMode>,
);
