// @vitest-environment jsdom
import { fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { RentalCheckoutView } from "./RentalCheckoutView";

const MERCHANT_ID = "018f1e2a-0000-7000-8000-000000000002";
const ORDER_LINE_ID = "018f1e2a-0000-7000-8000-000000000031";
const REPORT_ID = "018f1e2a-0000-7000-8000-000000000032";

function jsonResponse(ok: boolean, body: unknown, status = 200): Response {
  return { ok, status, json: () => Promise.resolve(body) } as Response;
}

describe("RentalCheckoutView (D116 — Rental check-out flow)", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("shows guidance to photograph the asset, not the customer — this card's security check", () => {
    vi.stubGlobal("fetch", vi.fn());
    render(<RentalCheckoutView merchantId={MERCHANT_ID} orderLineId={ORDER_LINE_ID} />);

    expect(screen.getByText(/never photograph the customer or any other person/i)).toBeInTheDocument();
  });

  it("disables Complete checkout until a condition report has been recorded — this card's acceptance criterion", () => {
    vi.stubGlobal("fetch", vi.fn());
    render(<RentalCheckoutView merchantId={MERCHANT_ID} orderLineId={ORDER_LINE_ID} />);

    expect(screen.getByRole("button", { name: "Complete checkout" })).toBeDisabled();
  });

  it("enables Complete checkout once the CHECKOUT condition report is saved, and completes checkout on submit", async () => {
    const fetchMock = vi.fn().mockImplementation((url: string, init?: RequestInit) => {
      if (typeof url === "string" && url.endsWith("/condition-reports/checkout") && init?.method === "POST") {
        return Promise.resolve(jsonResponse(true, { id: REPORT_ID, phase: "CHECKOUT", conditionGrade: "GOOD" }, 201));
      }
      if (typeof url === "string" && url.endsWith("/pickup") && init?.method === "POST") {
        return Promise.resolve(jsonResponse(true, { id: "event-1" }, 201));
      }
      return Promise.reject(new Error(`Unexpected fetch: ${url}`));
    });
    vi.stubGlobal("fetch", fetchMock);

    render(<RentalCheckoutView merchantId={MERCHANT_ID} orderLineId={ORDER_LINE_ID} />);

    fireEvent.change(screen.getByLabelText("Inventory unit"), { target: { value: "unit-1" } });
    fireEvent.click(screen.getByRole("button", { name: "Save condition report" }));

    await screen.findByText("Condition report recorded (GOOD).");
    expect(screen.getByRole("button", { name: "Complete checkout" })).not.toBeDisabled();

    fireEvent.click(screen.getByRole("button", { name: "Complete checkout" }));

    await screen.findByText("Checked out.");
    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringContaining(`/order-lines/${ORDER_LINE_ID}/pickup`),
      expect.objectContaining({ method: "POST" }),
    );
  });

  it("surfaces a 409 from the pickup endpoint as an explicit error rather than a silent failure", async () => {
    const fetchMock = vi.fn().mockImplementation((url: string, init?: RequestInit) => {
      if (typeof url === "string" && url.endsWith("/condition-reports/checkout") && init?.method === "POST") {
        return Promise.resolve(jsonResponse(true, { id: REPORT_ID, phase: "CHECKOUT", conditionGrade: "GOOD" }, 201));
      }
      if (typeof url === "string" && url.endsWith("/pickup") && init?.method === "POST") {
        return Promise.resolve(jsonResponse(false, {}, 409));
      }
      return Promise.reject(new Error(`Unexpected fetch: ${url}`));
    });
    vi.stubGlobal("fetch", fetchMock);

    render(<RentalCheckoutView merchantId={MERCHANT_ID} orderLineId={ORDER_LINE_ID} />);

    fireEvent.change(screen.getByLabelText("Inventory unit"), { target: { value: "unit-1" } });
    fireEvent.click(screen.getByRole("button", { name: "Save condition report" }));
    await screen.findByText("Condition report recorded (GOOD).");

    fireEvent.click(screen.getByRole("button", { name: "Complete checkout" }));

    await screen.findByRole("alert");
    expect(
      screen.getByText("A CHECKOUT condition report is required before this order line can be picked up."),
    ).toBeInTheDocument();
  });
});
