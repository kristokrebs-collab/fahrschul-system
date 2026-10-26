/** Clipboard with a fallback for browsers / contexts without `navigator.clipboard` (http, old WebViews). */
export async function copyText(text: string): Promise<boolean> {
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    /* fall through to the selection copy */
  }
  try {
    const ta = document.createElement("textarea");
    ta.value = text;
    ta.setAttribute("readonly", "");
    ta.style.position = "fixed";
    ta.style.opacity = "0";
    document.body.appendChild(ta);
    ta.select();
    const ok = document.execCommand("copy");
    ta.remove();
    return ok;
  } catch {
    return false;
  }
}

/** The system share sheet when there is one (phones); false = not available or cancelled. */
export async function nativeShare(url: string, title: string): Promise<boolean> {
  const nav = navigator as Navigator & { share?: (d: ShareData) => Promise<void>; canShare?: (d: ShareData) => boolean };
  if (typeof nav.share !== "function") return false;
  try {
    await nav.share({ url, title });
    return true;
  } catch {
    return false;
  }
}

export const canNativeShare = (): boolean => typeof (navigator as Navigator & { share?: unknown }).share === "function";
