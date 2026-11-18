/**
 * Leaf host of the contract pages (B4): loads the sheet lazily the first time a page is asked for – by a link (`openContract`)
 * or by a deep link on load (`/?kuendigen`, `/?widerruf`, and the link of the confirmation mail `/?kuendigen=<token>`). The query
 * is removed from the address bar once read; the hash route stays. Inside claude.ai / without the cloud: nothing.
 */
import { lazy, Suspense, useEffect } from "react";
import { contractLinksShown, contractOfUrl, openContract, useContract } from "../contractStore";

const ContractSheet = lazy(() => import("./ContractSheet").then((m) => ({ default: m.ContractSheet })));

export function ContractHost() {
  const loaded = useContract((s) => s.loaded);
  useEffect(() => {
    if (!contractLinksShown() || typeof location === "undefined") return;
    const hit = contractOfUrl(location.href);
    if (!hit) return;
    try {
      const u = new URL(location.href);
      u.searchParams.delete(hit.param);
      history.replaceState(history.state, "", u.pathname + u.search + u.hash);
    } catch {
      /* the sheet opens anyway */
    }
    openContract(hit.kind, hit.token);
  }, []);
  if (!loaded || !contractLinksShown()) return null;
  return (
    <Suspense fallback={null}>
      <ContractSheet />
    </Suspense>
  );
}
