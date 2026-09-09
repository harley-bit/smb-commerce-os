// @vitest-environment jsdom
import { render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { OrderDetailView } from "./OrderDetailView";

const MERCHANT_ID = "018f1e2a-0000-7000-8000-000000000002";
const ORDER_ID = "018f1e2a-0000-7000-8000-000000000030";

const ORDER_DETAIL = {
  id: ORDER_ID,
  status: "CONFIRMED",
  currency: "USD",
  subtotalMinor: 11900,
  taxMinor: 0,
  totalMinor: 11900,
  placedAt: "2026-10-01T00:00:00.000Z",
  cancelledAt: null,
  modes: ["PRODUCT", "SERVICE", "RENTAL"] as const,
  lines: [
    {
      id: "line-1",
      listingId: "listing-1",
      listingName: "Mug",
      variantId: "variant-1",
      mode: "PRODUCT" as const,
      quantity: 2,
      unitPriceMinor: 1200,
      lineTotalMinor: 2400,
      depositMinor: null,
      startsAt: null,
      endsAt: null,
    },
    {
      id: "line-2",
      listingId: "listing-2",
      listingName: "Haircut",
      variantId: "variant-2",
      mode: "SERVICE" as const,
      quantity: 1,
      unitPriceMinor: 4500,
      lineTotalMinor: 4500,
      depositMinor: null,
      startsAt: "2026-10-01T09:00:00.000Z",
      endsAt: "2026-10-01T09:30:00.000Z",
    },
    {
      id: "line-3",
      listingId: "listing-3",
      listingName: "Kayak",
      variantId: "variant-3",
      mode: "RENTAL" as const,
      quantity: 1,
      unitPriceMinor: 5000,
      lineTotalMinor: 5000,
      depositMinor: null,
      startsAt: "2026-10-02T09:00:00.000Z",
      endsAt: "2026-10-03T09:00:00.000Z",
    },
  ],
};

function mockFetchOnce(ok: boolean, body: unknown, status = 200) {
  const fetchMock = vi.fn().mockResolvedValue({ ok, status, json: () => Promise.resolve(body) } as Response);
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

describe("OrderDetailView (D115 — Order list and detail)", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("fetches the order scoped to the caller's merchant via X-Merchant-Id", async () => {
    const fetchMock = mockFetchOnce(true, ORDER_DETAIL);
    render(<OrderDetailView merchantId={MERCHANT_ID} orderId={ORDER_ID} />);

    await screen.findByText("Mug");
    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringContaining(`/orders/${ORDER_ID}`),
      expect.objectContaining({ headers: { "x-merchant-id": MERCHANT_ID } }),
    );
  });

  it("renders a PRODUCT, a SERVICE, and a RENTAL line on the same order — this card's acceptance criterion", async () => {
    mockFetchOnce(true, ORDER_DETAIL);
    render(<OrderDetailView merchantId={MERCHANT_ID} orderId={ORDER_ID} />);

    await screen.findByText("Mug");
    expect(screen.getByText("Haircut")).toBeInTheDocument();
    expect(screen.getByText("Kayak")).toBeInTheDocument();
  });

  it("shows a not-found message on a 404", async () => {
    mockFetchOnce(false, {}, 404);
    render(<OrderDetailView merchantId={MERCHANT_ID} orderId={ORDER_ID} />);

    await screen.findByText("Order not found.");
  });
});
