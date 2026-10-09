import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "./styles/base.css";
import App from "./App";
import { bootMarket } from "@/app/marketBoot";
import { MotionRoot } from "@/motion/MotionRoot";
import { bootJournal } from "@/store/journalStore";
import { installRouter } from "@/store/router";

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

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <MotionRoot>
      <App />
    </MotionRoot>
  </StrictMode>,
);
