// @vitest-environment jsdom
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { TextField } from "./TextField";

describe("TextField", () => {
  it("programmatically associates its visible label with the input (getByLabelText resolves it)", () => {
    render(<TextField label="Email" name="email" type="email" />);
    const input = screen.getByLabelText("Email");
    expect(input).toBeInstanceOf(HTMLInputElement);
    expect(input).toHaveAttribute("type", "email");
  });

  it("is reachable by keyboard Tab and accepts typed input", async () => {
    const user = userEvent.setup();
    render(<TextField label="Email" name="email" type="email" />);

    await user.tab();
    const input = screen.getByLabelText("Email");
    expect(input).toHaveFocus();

    await user.keyboard("a@b.com");
    expect(input).toHaveValue("a@b.com");
  });

  it("exposes a validation error to assistive tech via aria-describedby and aria-invalid, not color alone", () => {
    render(<TextField label="Email" name="email" type="email" error="Enter a valid email address." />);
    const input = screen.getByLabelText("Email");
    expect(input).toHaveAttribute("aria-invalid", "true");
    const describedBy = input.getAttribute("aria-describedby");
    expect(describedBy).toBeTruthy();
    const errorNode = document.getElementById(describedBy as string);
    expect(errorNode?.textContent).toBe("Enter a valid email address.");
  });

  it("never uses an inline style attribute on the input or its label", () => {
    render(<TextField label="Email" name="email" />);
    expect(screen.getByLabelText("Email")).not.toHaveAttribute("style");
    expect(screen.getByText("Email")).not.toHaveAttribute("style");
  });

  it("generates a unique id per instance, so two fields on one page never collide", () => {
    render(
      <>
        <TextField label="Email" name="email" />
        <TextField label="Email" name="email2" />
      </>,
    );
    const [first, second] = screen.getAllByLabelText("Email");
    expect(first).toBeDefined();
    expect(second).toBeDefined();
    expect(first?.id).not.toBe(second?.id);
  });
});
