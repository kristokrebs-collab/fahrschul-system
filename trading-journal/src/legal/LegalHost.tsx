/**
 * Leaf host of the legal sheet (Review F07): loads the sheet lazily the first time a document is asked for – by a
 * link (`openLegal`) or by the deep link `/?rechtliches=<doc>` on load (Stripe's terms URL, e-mails). The query is
 * removed from the address bar once read, the hash route stays untouched. Inside claude.ai: nothing.
 */
import { lazy, Suspense, useEffect } from "react";
import { legalDocOfUrl, legalShown } from "./config";
import { openLegal, useLegal } from "./store";

const LegalSheet = lazy(() => import("./LegalSheet"));

export function LegalHost() {
  const loaded = useLegal((s) => s.loaded);
  useEffect(() => {
    if (!legalShown() || typeof location === "undefined") return;
    const doc = legalDocOfUrl(location.href);
    if (!doc) return;
    try {
      const u = new URL(location.href);
      u.searchParams.delete("rechtliches");
      history.replaceState(history.state, "", u.pathname + u.search + u.hash);
    } catch {
      /* the sheet opens anyway */
    }
    openLegal(doc);
  }, []);
  if (!loaded || !legalShown()) return null;
  return (
    <Suspense fallback={null}>
      <LegalSheet />
    </Suspense>
  );
}
