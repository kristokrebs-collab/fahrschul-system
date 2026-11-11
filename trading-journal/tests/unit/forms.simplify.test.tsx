/**
 * The small form simplifications of A8 (`docs/UX-MATRIX-74.md`, V1–V4): a required field says so ("Pflicht" after the label, as
 * generated content – the control keeps the name "Preis"), the error under a field goes away when the field is edited, and the
 * key-level editor takes over the live price with one tap. Optional fields stay unmarked; the primary actions are untouched.
 */
import { fireEvent, render, screen, within } from "@testing-library/react";
import { beforeAll, describe, expect, it, vi } from "vitest";
import { Field } from "@/primitives/Field";
import { Input } from "@/primitives/Input";
import { MotionRoot } from "@/motion/MotionRoot";
import { KeyLevelEditor } from "@/views/schluesselmarken/KeyLevelEditor";
import type { TfAvailability } from "@/domain/keylevels";
import { installDomPolyfills } from "./views.overview.harness";

const TFS: TfAvailability[] = ["30m", "1h", "2h", "3h", "4h", "1D", "1W"].map((tf) => ({ tf, ok: true, reason: null })) as TfAvailability[];

describe("Field required (V1)", () => {
  it("marks a required field on its label and leaves the control's name alone; an optional field has no mark", () => {
    render(
      <>
        <Field label="Preis" htmlFor="p" required>
          <Input id="p" />
        </Field>
        <Field label="Notiz" htmlFor="n">
          <Input id="n" />
        </Field>
      </>,
    );
    // the label text is just "Preis": a test, the search and a screen reader's name stay as they were
    expect(screen.getByLabelText("Preis")).toBeInTheDocument();
    expect(screen.getByText("Preis")).toHaveAttribute("data-required");
    expect(screen.getByText("Preis").className).toContain("after:content-['Pflicht']");
    expect(screen.getByText("Notiz")).not.toHaveAttribute("data-required");
    expect(screen.getByText("Notiz").className).not.toContain("Pflicht");
  });
});

describe("key-level editor (V1–V3)", () => {
  beforeAll(() => installDomPolyfills());
  const editor = (price: number | null = 85_432) =>
    render(
      <MotionRoot>
        <KeyLevelEditor level={null} symbol="BTCUSDT" tf={TFS} price={price} onSave={vi.fn()} onCancel={vi.fn()} />
      </MotionRoot>,
    );

  it("marks the price as required, the name stays optional", () => {
    editor();
    expect(screen.getByText("Preis")).toHaveAttribute("data-required");
    expect(screen.getByText("Name")).not.toHaveAttribute("data-required");
  });

  it("takes over the live price with one tap, and not at all without a live price", () => {
    const first = editor(85_432);
    const price = screen.getByLabelText("Preis") as HTMLInputElement;
    expect(price.value).toBe("");
    fireEvent.click(screen.getByTestId("keylevel-use-price"));
    expect(price.value).toBe("85432");
    first.unmount();
    editor(null);
    expect(screen.queryByTestId("keylevel-use-price")).toBeNull();
  });

  it("shows the price error at the field and takes it away as soon as the field is edited", () => {
    editor(85_432);
    fireEvent.submit(screen.getByTestId("keylevel-editor"));
    const field = screen.getByLabelText("Preis").closest("[data-field]") as HTMLElement;
    expect(within(field).getByRole("alert")).toHaveTextContent("Bitte einen Preis über 0 eingeben.");
    fireEvent.change(screen.getByLabelText("Preis"), { target: { value: "8" } });
    expect(within(field).queryByRole("alert")).toBeNull();
  });
});
