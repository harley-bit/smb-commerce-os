// @vitest-environment jsdom
import { render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { DepositManagementView } from "./DepositManagementView";

const MERCHANT_ID = "018f1e2a-0000-7000-8000-000000000002";

interface DepositRow {
  id: string;
  orderLineId: string;
  amountMinor: number;
  currency: string;
  state: string;
  authorizedAt: string;
  expiresAt: string;
  capturedMinor: number | null;
  releasedAt: string | null;
  bucket: "HELD" | "EXPIRING_SOON" | "CAPTURED" | "RELEASED" | "EXPIRED";
}

function jsonResponse(ok: boolean, body: unknown, status = 200): Response {
  return { ok, status, json: () => Promise.resolve(body) } as Response;
}

function mockDeposits(rows: DepositRow[]) {
  const fetchMock = vi.fn().mockImplementation((url: string) => {
    if (typeof url === "string" && url.endsWith("/deposits")) {
      return Promise.resolve(jsonResponse(true, rows));
    }
    return Promise.reject(new Error(`Unexpected fetch: ${url}`));
  });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("DepositManagementView", () => {
  it("shows an empty state when there are no deposits", async () => {
    mockDeposits([]);
    render(<DepositManagementView merchantId={MERCHANT_ID} />);

    expect(await screen.findByText("No deposit holds yet.")).toBeInTheDocument();
  });

  it("surfaces an expiring-soon hold in its own section before it lapses", async () => {
    mockDeposits([
      {
        id: "dep-1",
        orderLineId: "line-1",
        amountMinor: 20_000,
        currency: "USD",
        state: "AUTHORIZED",
        authorizedAt: "2026-09-01T00:00:00.000Z",
        expiresAt: "2026-09-09T12:00:00.000Z",
        capturedMinor: null,
        releasedAt: null,
        bucket: "EXPIRING_SOON",
      },
    ]);
    render(<DepositManagementView merchantId={MERCHANT_ID} />);

    const expiringSection = await screen.findByRole("region", { name: "Expiring soon" });
    expect(expiringSection).toHaveTextContent("200.00 USD");
  });

  it("groups held, captured, and released deposits into their own sections", async () => {
    mockDeposits([
      {
        id: "dep-held",
        orderLineId: "line-held",
        amountMinor: 10_000,
        currency: "USD",
        state: "AUTHORIZED",
        authorizedAt: "2026-09-01T00:00:00.000Z",
        expiresAt: "2026-09-30T00:00:00.000Z",
        capturedMinor: null,
        releasedAt: null,
        bucket: "HELD",
      },
      {
        id: "dep-captured",
        orderLineId: "line-captured",
        amountMinor: 15_000,
        currency: "USD",
        state: "CAPTURED",
        authorizedAt: "2026-09-01T00:00:00.000Z",
        expiresAt: "2026-09-30T00:00:00.000Z",
        capturedMinor: 15_000,
        releasedAt: null,
        bucket: "CAPTURED",
      },
      {
        id: "dep-released",
        orderLineId: "line-released",
        amountMinor: 5_000,
        currency: "USD",
        state: "RELEASED",
        authorizedAt: "2026-09-01T00:00:00.000Z",
        expiresAt: "2026-09-30T00:00:00.000Z",
        capturedMinor: null,
        releasedAt: "2026-09-05T00:00:00.000Z",
        bucket: "RELEASED",
      },
    ]);
    render(<DepositManagementView merchantId={MERCHANT_ID} />);

    expect(await screen.findByRole("region", { name: "Held" })).toHaveTextContent("100.00 USD");
    expect(await screen.findByRole("region", { name: "Captured" })).toHaveTextContent("150.00 USD");
    expect(await screen.findByRole("region", { name: "Released" })).toHaveTextContent("50.00 USD");
  });

  it("shows an error when the load fails", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(false, {}, 500));
    vi.stubGlobal("fetch", fetchMock);
    render(<DepositManagementView merchantId={MERCHANT_ID} />);

    expect(await screen.findByRole("alert")).toHaveTextContent("Could not load deposit holds.");
  });
});
