// @vitest-environment jsdom
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ProductEditor } from "./ProductEditor";

const MERCHANT_ID = "018f1e2a-0000-7000-8000-000000000001";
const LISTING_ID = "018f1e2a-0000-7000-8000-000000000002";
const VARIANT_ID = "018f1e2a-0000-7000-8000-000000000003";

function mockFetchSequence(...responses: Array<{ ok: boolean; body: unknown }>) {
  const fetchMock = vi.fn();
  for (const { ok, body } of responses) {
    fetchMock.mockImplementationOnce(() =>
      Promise.resolve({ ok, json: () => Promise.resolve(body) } as Response),
    );
  }
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

const SAVED_LISTING = {
  id: LISTING_ID,
  merchantId: MERCHANT_ID,
  mode: "PRODUCT",
  name: "Widget",
  slug: "widget",
  description: null,
  status: "DRAFT",
  createdAt: "2026-09-08T00:00:00.000Z",
  archivedAt: null,
};

const SAVED_VARIANT = {
  id: VARIANT_ID,
  merchantId: MERCHANT_ID,
  listingId: LISTING_ID,
  mode: "PRODUCT",
  sku: "WIDGET-RED",
  name: "Widget — Red",
  attributesJson: null,
  priceMinor: 1999,
  currency: "USD",
  durationMinutes: null,
  ratePeriod: null,
  depositMinor: null,
  bufferMinutes: null,
  archivedAt: null,
};

describe("ProductEditor (D106 — Listing editor: product)", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("creates a PRODUCT listing with a variant and renders both back from the server", async () => {
    const fetchMock = mockFetchSequence(
      { ok: true, body: { id: LISTING_ID } },
      { ok: true, body: { id: VARIANT_ID } },
      { ok: true, body: SAVED_LISTING },
      { ok: true, body: [SAVED_VARIANT] },
    );
    const user = userEvent.setup();
    render(<ProductEditor merchantId={MERCHANT_ID} />);

    await user.type(screen.getByLabelText("Name"), "Widget");
    await user.type(screen.getByLabelText("Slug"), "widget");
    await user.click(screen.getByRole("button", { name: "Add variant" }));
    await user.type(screen.getByLabelText("SKU"), "WIDGET-RED");
    await user.type(screen.getByLabelText("Variant name"), "Widget — Red");
    await user.type(screen.getByLabelText("Price (minor units)"), "1999");
    await user.type(screen.getByLabelText("Currency"), "USD");

    await user.click(screen.getByRole("button", { name: "Save product" }));

    await screen.findByText("Widget");
    await screen.findByText(/Widget — Red/);
    expect(screen.getByText(/1999/)).toBeInTheDocument();

    expect(fetchMock).toHaveBeenNthCalledWith(
      1,
      expect.stringContaining("/listings"),
      expect.objectContaining({
        method: "POST",
        headers: expect.objectContaining({ "x-merchant-id": MERCHANT_ID }),
        body: expect.stringContaining('"mode":"PRODUCT"'),
      }),
    );
    expect(fetchMock).toHaveBeenNthCalledWith(
      2,
      expect.stringContaining(`/listings/${LISTING_ID}/variants`),
      expect.objectContaining({ method: "POST" }),
    );
  });

  it("rejects an incomplete form client-side and never calls fetch — mirrors the server's Zod schema", async () => {
    const fetchMock = mockFetchSequence();
    const user = userEvent.setup();
    render(<ProductEditor merchantId={MERCHANT_ID} />);

    await user.click(screen.getByRole("button", { name: "Save product" }));

    await screen.findByRole("alert");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("surfaces a server rejection without silently discarding the form", async () => {
    const fetchMock = mockFetchSequence({ ok: false, body: { detail: "Bad Request" } });
    const user = userEvent.setup();
    render(<ProductEditor merchantId={MERCHANT_ID} />);

    await user.type(screen.getByLabelText("Name"), "Widget");
    await user.type(screen.getByLabelText("Slug"), "widget");
    await user.click(screen.getByRole("button", { name: "Save product" }));

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    await screen.findByRole("alert");
  });
});
