/** Reads a picked file as text (`Blob.text` where it exists, else FileReader). Nothing leaves the browser. */
export function readFileText(file: Blob): Promise<string> {
  if (typeof file.text === "function") return file.text();
  return new Promise((resolve, reject) => {
    const fr = new FileReader();
    fr.onload = () => resolve(String(fr.result ?? ""));
    fr.onerror = () => reject(fr.error ?? new Error("read"));
    fr.readAsText(file);
  });
}
