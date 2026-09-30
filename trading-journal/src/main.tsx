import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "./styles/base.css";
import App from "./App";
import { bootMarket } from "@/app/marketBoot";
import { MotionRoot } from "@/motion/MotionRoot";
import { bootJournal } from "@/store/journalStore";
import { installRouter } from "@/store/router";

// Font hints: the numerals (Doto) and the mono axis font are needed for the first paint of the hero /
// charts; requesting them early avoids a late swap (Plan 9.4). Fire-and-forget, never blocks.
try {
  const fonts = (document as Document & { fonts?: FontFaceSet }).fonts;
  void fonts?.load('800 1em "Doto"');
  void fonts?.load('500 11px "IBM Plex Mono"');
  void fonts?.load('600 14px "IBM Plex Sans"');
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
