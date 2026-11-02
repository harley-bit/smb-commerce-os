// @vitest-environment jsdom
import { render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { OrderConfirmationView } from "./OrderConfirmationView";

const SLUG = "acme-rentals";
const ORDER_ID = "order-1";

const RECEIPT = {
  orderId: ORDER_ID,
  currency: "USD",
  subtotalMinor: 6000,
  taxMinor: 0,
  totalMinor: 6000,
  lineItems: [
    {
      orderLineId: "line-1",
      mode: "PRODUCT",
      quantity: 2,
      unitPriceMinor: 1000,
      lineTotalMinor: 2000,
      depositHoldMinor: null,
    },
    {
      orderLineId: "line-2",
      mode: "RENTAL",
      quantity: 1,
      unitPriceMinor: 4000,
      lineTotalMinor: 4000,
      depositHoldMinor: 20000,
    },
  ],
  depositHoldsTotalMinor: 20000,
};

function jsonResponse(body: unknown, status = 200): Response {
  return { ok: status < 300, status, json: () => Promise.resolve(body) } as Response;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("OrderConfirmationView", () => {
  it("D131 acceptance criterion: itemizes every charge and shows the deposit hold total", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse(RECEIPT, 201)));

    render(<OrderConfirmationView slug={SLUG} orderId={ORDER_ID} />);

    expect(await screen.findByText(/20\.00 USD/)).toBeInTheDocument();
    expect(screen.getByText(/40\.00 USD/)).toBeInTheDocument();
    expect(screen.getAllByText(/deposit hold/i).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/200\.00 USD/).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/60\.00 USD/).length).toBeGreaterThan(0);
  });

  it("D131 security check: never renders any card-shaped text or input", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse(RECEIPT, 201)));

    const { container } = render(<OrderConfirmationView slug={SLUG} orderId={ORDER_ID} />);
    await screen.findByText(/20\.00 USD/);

    expect(container.querySelectorAll("input")).toHaveLength(0);
    expect(container.textContent).not.toMatch(/card number|cvc|expiry/i);
  });

  it("posts to the confirmation endpoint for this order", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(RECEIPT, 201));
    vi.stubGlobal("fetch", fetchMock);

    render(<OrderConfirmationView slug={SLUG} orderId={ORDER_ID} />);
    await screen.findByText(/20\.00 USD/);

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toContain(`/v1/m/${SLUG}/checkout/${ORDER_ID}/confirmation`);
    expect(init.method).toBe("POST");
  });

  it("shows an error message when the order cannot be found", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse({}, 404)));

    render(<OrderConfirmationView slug={SLUG} orderId={ORDER_ID} />);

    expect(await screen.findByRole("alert")).toHaveTextContent(/could not/i);
  });
});
