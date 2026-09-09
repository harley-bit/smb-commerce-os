// @vitest-environment jsdom
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { RentalEditor } from "./RentalEditor";

const MERCHANT_ID = "018f1e2a-0000-7000-8000-000000000001";
const LISTING_ID = "018f1e2a-0000-7000-8000-000000000002";
const VARIANT_ID = "018f1e2a-0000-7000-8000-000000000003";

function mockFetchSequence(...responses: Array<{ ok: boolean; body: unknown }>) {
  const fetchMock = vi.fn();
  for (const { ok, body } of responses) {
    fetchMock.mockImplementationOnce(() => Promise.resolve({ ok, json: () => Promise.resolve(body) } as Response));
  }
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

const SAVED_LISTING = {
  id: LISTING_ID,
  merchantId: MERCHANT_ID,
  mode: "RENTAL",
  name: "Kayak",
  slug: "kayak",
  description: null,
  status: "DRAFT",
  createdAt: "2026-09-08T00:00:00.000Z",
  archivedAt: null,
};

const SAVED_VARIANT = {
  id: VARIANT_ID,
  merchantId: MERCHANT_ID,
  listingId: LISTING_ID,
  mode: "RENTAL",
  sku: "KAYAK-1",
  name: "Single kayak",
  attributesJson: null,
  priceMinor: 5000,
  currency: "USD",
  durationMinutes: null,
  ratePeriod: "DAY",
  depositMinor: 20000,
  bufferMinutes: 30,
  archivedAt: null,
};

async function fillRequiredFields(user: ReturnType<typeof userEvent.setup>) {
  await user.type(screen.getByLabelText("Name"), "Kayak");
  await user.type(screen.getByLabelText("Slug"), "kayak");
  await user.type(screen.getByLabelText("SKU"), "KAYAK-1");
  await user.type(screen.getByLabelText("Variant name"), "Single kayak");
  await user.type(screen.getByLabelText("Price (minor units)"), "5000");
  await user.type(screen.getByLabelText("Currency"), "USD");
  await user.selectOptions(screen.getByLabelText("Rate period"), "DAY");
  await user.type(screen.getByLabelText("Deposit (minor units)"), "20000");
  await user.type(screen.getByLabelText("Turnaround buffer (minutes)"), "30");
}

describe("RentalEditor (D108 — Listing editor: rental)", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("creates a RENTAL listing with a rate/deposit/buffer variant and renders both back from the server", async () => {
    const fetchMock = mockFetchSequence(
      { ok: true, body: { id: LISTING_ID } }, // POST /listings
      { ok: true, body: { id: VARIANT_ID } }, // POST /listings/:id/variants
      { ok: true, body: SAVED_LISTING }, // GET /listings/:id
      { ok: true, body: [SAVED_VARIANT] }, // GET /listings/:id/variants
    );
    const user = userEvent.setup();
    render(<RentalEditor merchantId={MERCHANT_ID} />);

    await fillRequiredFields(user);
    await user.click(screen.getByRole("button", { name: "Save rental" }));

    await screen.findByText("Kayak");
    expect(screen.getByText(/Single kayak/)).toBeInTheDocument();
    expect(screen.getByText(/DAY/)).toBeInTheDocument();
    expect(screen.getByText(/deposit 20000/)).toBeInTheDocument();
    expect(screen.getByText(/buffer 30 min/)).toBeInTheDocument();

    expect(fetchMock).toHaveBeenNthCalledWith(
      1,
      expect.stringContaining("/listings"),
      expect.objectContaining({
        method: "POST",
        headers: expect.objectContaining({ "x-merchant-id": MERCHANT_ID }),
        body: expect.stringContaining('"mode":"RENTAL"'),
      }),
    );
    expect(fetchMock).toHaveBeenNthCalledWith(
      2,
      expect.stringContaining(`/listings/${LISTING_ID}/variants`),
      expect.objectContaining({
        method: "POST",
        body: expect.stringContaining('"depositMinor":20000'),
      }),
    );
  });

  it("rejects an incomplete form client-side and never calls a save fetch — mirrors the server's Zod schema", async () => {
    const fetchMock = mockFetchSequence();
    const user = userEvent.setup();
    render(<RentalEditor merchantId={MERCHANT_ID} />);

    await user.click(screen.getByRole("button", { name: "Save rental" }));

    await screen.findByRole("alert");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("shows the window-ceiling warning for a typical rental term longer than 30 days", async () => {
    const user = userEvent.setup();
    render(<RentalEditor merchantId={MERCHANT_ID} />);

    expect(screen.queryByRole("status")).not.toBeInTheDocument();

    await user.type(screen.getByLabelText("Typical rental term (days)"), "45");

    expect(screen.getByRole("status")).toHaveTextContent(/exceeds the 30-day/);
  });

  it("shows no window-ceiling warning for a term within the 30-day ceiling", async () => {
    const user = userEvent.setup();
    render(<RentalEditor merchantId={MERCHANT_ID} />);

    await user.type(screen.getByLabelText("Typical rental term (days)"), "14");

    expect(screen.queryByRole("status")).not.toBeInTheDocument();
  });
});
