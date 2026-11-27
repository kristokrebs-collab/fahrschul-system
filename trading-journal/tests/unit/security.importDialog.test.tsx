/**
 * Security round 11, package C – the import dialog: a file far larger than any backup is refused before it is read into memory,
 * and the wording about pictures is honest (hash = unversehrt, not echt).
 */
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { IMPORT_MAX_JSON_BYTES, IMPORT_SHOT_STRINGS, IMPORT_STRINGS, ImportDialog } from "@/overlays/ImportDialog";
import { MotionRoot } from "@/motion/MotionRoot";

const withSize = (f: File, size: number): File => {
  Object.defineProperty(f, "size", { value: size });
  return f;
};

describe("ImportDialog – limits and wording", () => {
  it("refuses a JSON file over the limit without reading it", async () => {
    const readFile = vi.fn(async (f: File) => f.text());
    render(
      <MotionRoot>
        <ImportDialog open onClose={() => undefined} readFile={readFile} />
      </MotionRoot>,
    );
    const input = document.querySelector('input[type="file"]') as HTMLInputElement;
    const big = withSize(new File(["{}"], "huge.json", { type: "application/json" }), IMPORT_MAX_JSON_BYTES + 1);
    fireEvent.change(input, { target: { files: [big] } });
    await waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent(IMPORT_STRINGS.tooBig(200)));
    expect(readFile).not.toHaveBeenCalled();
    expect(screen.getByRole("button", { name: "Importieren" })).toBeDisabled();
  });

  it("a file just under the limit is read as before", async () => {
    const text = JSON.stringify({ exportedAt: "2026-03-02T00:00:00.000Z", trades: [] });
    const readFile = vi.fn(async () => text);
    render(
      <MotionRoot>
        <ImportDialog open onClose={() => undefined} readFile={readFile} />
      </MotionRoot>,
    );
    const input = document.querySelector('input[type="file"]') as HTMLInputElement;
    fireEvent.change(input, { target: { files: [withSize(new File([text], "ok.json", { type: "application/json" }), IMPORT_MAX_JSON_BYTES)] } });
    await waitFor(() => expect(screen.getByTestId("import-preview")).toBeInTheDocument());
    expect(readFile).toHaveBeenCalledTimes(1);
  });

  it("the picture line says 'unversehrt' and that a hash is no proof the backup is yours; no 'bytegleich' / 'echt'", () => {
    const line = IMPORT_SHOT_STRINGS.zipEmbedded(3);
    expect(line).toContain("unversehrt");
    expect(line).toContain("nicht dass das Backup von dir stammt");
    expect(line).toContain("Vorhandene Screenshots werden nicht überschrieben");
    expect(line).not.toMatch(/bytegleich|echt\b|rechtskräftig/i);
  });
});
