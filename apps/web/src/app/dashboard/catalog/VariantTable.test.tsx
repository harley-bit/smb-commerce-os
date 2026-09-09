// @vitest-environment jsdom
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { VariantTable } from "./VariantTable";

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

const VARIANT = {
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

describe("VariantTable (D109 — Variant management)", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("loads variants, bulk-edits a price, and renders the server's read-back", async () => {
    const fetchMock = mockFetchSequence(
      { ok: true, body: [VARIANT] },
      { ok: true, body: { id: VARIANT_ID } },
      { ok: true, body: [{ ...VARIANT, priceMinor: 2499 }] },
    );
    const user = userEvent.setup();
    render(<VariantTable merchantId={MERCHANT_ID} listingId={LISTING_ID} />);

    const priceInput = await screen.findByLabelText(`Price for ${VARIANT_ID}`);
    await user.clear(priceInput);
    await user.type(priceInput, "2499");

    await user.click(screen.getByRole("button", { name: "Save changes" }));

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(3));
    expect(fetchMock).toHaveBeenNthCalledWith(
      2,
      expect.stringContaining(`/listings/${LISTING_ID}/variants/${VARIANT_ID}`),
      expect.objectContaining({
        method: "PUT",
        headers: expect.objectContaining({ "x-merchant-id": MERCHANT_ID }),
        body: expect.stringContaining('"priceMinor":2499'),
      }),
    );

    await waitFor(async () => {
      expect(await screen.findByLabelText(`Price for ${VARIANT_ID}`)).toHaveValue("2499");
    });
  });

  it("rejects a non-integer price client-side and fires no PUT request", async () => {
    const fetchMock = mockFetchSequence({ ok: true, body: [VARIANT] });
    const user = userEvent.setup();
    render(<VariantTable merchantId={MERCHANT_ID} listingId={LISTING_ID} />);

    const priceInput = await screen.findByLabelText(`Price for ${VARIANT_ID}`);
    await user.clear(priceInput);
    await user.type(priceInput, "19.99");

    await user.click(screen.getByRole("button", { name: "Save changes" }));

    await screen.findByRole("alert");
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("disables Save changes until a row is actually edited", async () => {
    mockFetchSequence({ ok: true, body: [VARIANT] });
    render(<VariantTable merchantId={MERCHANT_ID} listingId={LISTING_ID} />);

    await screen.findByLabelText(`Price for ${VARIANT_ID}`);
    expect(screen.getByRole("button", { name: "Save changes" })).toBeDisabled();
  });
});
