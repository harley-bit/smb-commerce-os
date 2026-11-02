// @vitest-environment jsdom
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { CatalogView } from "./CatalogView";

const MERCHANT_ID = "018f1e2a-0000-7000-8000-000000000002";

const LISTINGS = [
  {
    id: "018f1e2a-0000-7000-8000-000000000010",
    merchantId: MERCHANT_ID,
    mode: "PRODUCT" as const,
    name: "Wireless Mouse",
    slug: "wireless-mouse",
    description: null,
    status: "PUBLISHED" as const,
    createdAt: "2026-01-01T00:00:00.000Z",
    archivedAt: null,
  },
  {
    id: "018f1e2a-0000-7000-8000-000000000011",
    merchantId: MERCHANT_ID,
    mode: "SERVICE" as const,
    name: "Haircut",
    slug: "haircut",
    description: null,
    status: "DRAFT" as const,
    createdAt: "2026-01-02T00:00:00.000Z",
    archivedAt: null,
  },
  {
    id: "018f1e2a-0000-7000-8000-000000000012",
    merchantId: MERCHANT_ID,
    mode: "RENTAL" as const,
    name: "Camping Tent",
    slug: "camping-tent",
    description: null,
    status: "ARCHIVED" as const,
    createdAt: "2026-01-03T00:00:00.000Z",
    archivedAt: "2026-01-10T00:00:00.000Z",
  },
];

function mockFetchOnce(ok: boolean, body: unknown) {
  const fetchMock = vi.fn().mockResolvedValue({ ok, json: () => Promise.resolve(body) } as Response);
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

describe("CatalogView (D105 — Catalog list view)", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("fetches listings scoped to the caller's merchant via X-Merchant-Id", async () => {
    const fetchMock = mockFetchOnce(true, LISTINGS);
    render(<CatalogView merchantId={MERCHANT_ID} />);

    await screen.findByText("Wireless Mouse");
    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringContaining("/listings"),
      expect.objectContaining({ headers: { "x-merchant-id": MERCHANT_ID } }),
    );
  });

  it("shows all three modes visible together in one view — this card's acceptance criterion", async () => {
    mockFetchOnce(true, LISTINGS);
    render(<CatalogView merchantId={MERCHANT_ID} />);

    await screen.findByText("Wireless Mouse");
    expect(screen.getByText("Haircut")).toBeInTheDocument();
    expect(screen.getByText("Camping Tent")).toBeInTheDocument();
  });

  it("filters by mode", async () => {
    mockFetchOnce(true, LISTINGS);
    const user = userEvent.setup();
    render(<CatalogView merchantId={MERCHANT_ID} />);

    await screen.findByText("Wireless Mouse");
    await user.selectOptions(screen.getByLabelText("Mode"), "SERVICE");

    expect(screen.queryByText("Wireless Mouse")).not.toBeInTheDocument();
    expect(screen.getByText("Haircut")).toBeInTheDocument();
    expect(screen.queryByText("Camping Tent")).not.toBeInTheDocument();
  });

  it("filters by status", async () => {
    mockFetchOnce(true, LISTINGS);
    const user = userEvent.setup();
    render(<CatalogView merchantId={MERCHANT_ID} />);

    await screen.findByText("Wireless Mouse");
    await user.selectOptions(screen.getByLabelText("Status"), "ARCHIVED");

    expect(screen.queryByText("Wireless Mouse")).not.toBeInTheDocument();
    expect(screen.queryByText("Haircut")).not.toBeInTheDocument();
    expect(screen.getByText("Camping Tent")).toBeInTheDocument();
  });

  it("combines mode and status filters", async () => {
    mockFetchOnce(true, LISTINGS);
    const user = userEvent.setup();
    render(<CatalogView merchantId={MERCHANT_ID} />);

    await screen.findByText("Wireless Mouse");
    await user.selectOptions(screen.getByLabelText("Mode"), "PRODUCT");
    await user.selectOptions(screen.getByLabelText("Status"), "DRAFT");

    await waitFor(() => {
      expect(screen.queryByText("Wireless Mouse")).not.toBeInTheDocument();
    });
    expect(screen.queryByText("Haircut")).not.toBeInTheDocument();
    expect(screen.queryByText("Camping Tent")).not.toBeInTheDocument();
  });

  it("surfaces a load failure without crashing", async () => {
    mockFetchOnce(false, {});
    render(<CatalogView merchantId={MERCHANT_ID} />);

    await screen.findByRole("alert");
  });

  it("shows an empty state when no listings match the current filters", async () => {
    mockFetchOnce(true, []);
    render(<CatalogView merchantId={MERCHANT_ID} />);

    await screen.findByText(/No listings/);
  });
});
