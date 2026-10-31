/** Copying text: the clipboard API where the browser allows it, else the selection of a field the caller passes. Nothing is sent anywhere. */
export async function copyText(text: string, area?: HTMLTextAreaElement | HTMLElement | null): Promise<boolean> {
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    /* fall through to the selection route */
  }
  try {
    if (area) {
      if (area instanceof HTMLTextAreaElement) {
        area.focus();
        area.select();
      } else {
        const sel = window.getSelection();
        const range = document.createRange();
        range.selectNodeContents(area);
        sel?.removeAllRanges();
        sel?.addRange(range);
      }
      return document.execCommand("copy");
    }
  } catch {
    /* ignore */
  }
  return false;
}
