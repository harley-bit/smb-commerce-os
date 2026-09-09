// @vitest-environment jsdom
import { render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { OrderListView } from "./OrderListView";

const MERCHANT_ID = "018f1e2a-0000-7000-8000-000000000002";

const ORDERS = [
  {
    id: "018f1e2a-0000-7000-8000-000000000030",
    status: "CONFIRMED",
    currency: "USD",
    totalMinor: 11900,
    placedAt: "2026-10-01T00:00:00.000Z",
    modes: ["PRODUCT", "SERVICE", "RENTAL"] as const,
  },
];

function mockFetchOnce(ok: boolean, body: unknown) {
  const fetchMock = vi.fn().mockResolvedValue({ ok, status: ok ? 200 : 500, json: () => Promise.resolve(body) } as Response);
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

describe("OrderListView (D115 — Order list and detail)", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("fetches orders scoped to the caller's merchant via X-Merchant-Id", async () => {
    const fetchMock = mockFetchOnce(true, ORDERS);
    render(<OrderListView merchantId={MERCHANT_ID} />);

    await screen.findByText("CONFIRMED");
    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringContaining("/orders"),
      expect.objectContaining({ headers: { "x-merchant-id": MERCHANT_ID } }),
    );
  });

  it("renders an order carrying all three modes — this card's acceptance criterion", async () => {
    mockFetchOnce(true, ORDERS);
    render(<OrderListView merchantId={MERCHANT_ID} />);

    await screen.findByText("PRODUCT, SERVICE, RENTAL");
  });

  it("shows an empty state when there are no orders", async () => {
    mockFetchOnce(true, []);
    render(<OrderListView merchantId={MERCHANT_ID} />);

    await screen.findByText("No orders yet.");
  });

  it("surfaces a load failure without crashing", async () => {
    mockFetchOnce(false, {});
    render(<OrderListView merchantId={MERCHANT_ID} />);

    await screen.findByRole("alert");
  });
});
