// @vitest-environment jsdom
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ServiceEditor } from "./ServiceEditor";

const MERCHANT_ID = "018f1e2a-0000-7000-8000-000000000001";
const LISTING_ID = "018f1e2a-0000-7000-8000-000000000002";
const VARIANT_ID = "018f1e2a-0000-7000-8000-000000000003";
const RESOURCE_ID = "018f1e2a-0000-7000-8000-000000000004";
const ASSIGNMENT_ID = "018f1e2a-0000-7000-8000-000000000005";

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

const AVAILABLE_RESOURCE = {
  id: RESOURCE_ID,
  merchantId: MERCHANT_ID,
  locationId: "018f1e2a-0000-7000-8000-000000000006",
  kind: "STAFF" as const,
  name: "Jamie Rivera",
  capacity: 1,
  archivedAt: null,
};

const SAVED_LISTING = {
  id: LISTING_ID,
  merchantId: MERCHANT_ID,
  mode: "SERVICE",
  name: "Haircut",
  slug: "haircut",
  description: null,
  status: "DRAFT",
  createdAt: "2026-09-08T00:00:00.000Z",
  archivedAt: null,
};

const SAVED_VARIANT = {
  id: VARIANT_ID,
  merchantId: MERCHANT_ID,
  listingId: LISTING_ID,
  mode: "SERVICE",
  sku: "HAIRCUT-STD",
  name: "Standard haircut",
  attributesJson: null,
  priceMinor: 4500,
  currency: "USD",
  durationMinutes: 30,
  ratePeriod: null,
  depositMinor: null,
  bufferMinutes: null,
  archivedAt: null,
};

const SAVED_ASSIGNMENT = {
  id: ASSIGNMENT_ID,
  merchantId: MERCHANT_ID,
  listingId: LISTING_ID,
  resourceId: RESOURCE_ID,
  createdAt: "2026-09-08T00:00:00.000Z",
};

describe("ServiceEditor (D107 — Listing editor: service)", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("creates a SERVICE listing with a duration variant and an assigned resource, and renders all three back from the server", async () => {
    const fetchMock = mockFetchSequence(
      { ok: true, body: [AVAILABLE_RESOURCE] }, // GET /resources on mount
      { ok: true, body: { id: LISTING_ID } }, // POST /listings
      { ok: true, body: { id: VARIANT_ID } }, // POST /listings/:id/variants
      { ok: true, body: { id: ASSIGNMENT_ID } }, // POST /listings/:id/resources
      { ok: true, body: SAVED_LISTING }, // GET /listings/:id
      { ok: true, body: [SAVED_VARIANT] }, // GET /listings/:id/variants
      { ok: true, body: [SAVED_ASSIGNMENT] }, // GET /listings/:id/resources
    );
    const user = userEvent.setup();
    render(<ServiceEditor merchantId={MERCHANT_ID} />);

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    await screen.findByText(/Jamie Rivera/);

    await user.type(screen.getByLabelText("Name"), "Haircut");
    await user.type(screen.getByLabelText("Slug"), "haircut");
    await user.type(screen.getByLabelText("SKU"), "HAIRCUT-STD");
    await user.type(screen.getByLabelText("Variant name"), "Standard haircut");
    await user.type(screen.getByLabelText("Price (minor units)"), "4500");
    await user.type(screen.getByLabelText("Currency"), "USD");
    await user.type(screen.getByLabelText("Duration (minutes)"), "30");
    await user.selectOptions(screen.getByLabelText("Fulfilled by"), RESOURCE_ID);

    await user.click(screen.getByRole("button", { name: "Save service" }));

    await screen.findByText("Haircut");
    await screen.findByText(/Standard haircut/);
    expect(screen.getByText(/30 min/)).toBeInTheDocument();
    expect(screen.getByText(/Fulfilled by: Jamie Rivera/)).toBeInTheDocument();

    expect(fetchMock).toHaveBeenNthCalledWith(
      2,
      expect.stringContaining("/listings"),
      expect.objectContaining({
        method: "POST",
        headers: expect.objectContaining({ "x-merchant-id": MERCHANT_ID }),
        body: expect.stringContaining('"mode":"SERVICE"'),
      }),
    );
    expect(fetchMock).toHaveBeenNthCalledWith(
      3,
      expect.stringContaining(`/listings/${LISTING_ID}/variants`),
      expect.objectContaining({
        method: "POST",
        body: expect.stringContaining('"durationMinutes":30'),
      }),
    );
    expect(fetchMock).toHaveBeenNthCalledWith(
      4,
      expect.stringContaining(`/listings/${LISTING_ID}/resources`),
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({ resourceId: RESOURCE_ID }),
      }),
    );
  });

  it("rejects an incomplete form client-side and never calls a save fetch — mirrors the server's Zod schema", async () => {
    const fetchMock = mockFetchSequence({ ok: true, body: [] });
    const user = userEvent.setup();
    render(<ServiceEditor merchantId={MERCHANT_ID} />);

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));

    await user.click(screen.getByRole("button", { name: "Save service" }));

    await screen.findByRole("alert");
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("rejects a save with no resource selected — resource assignment is required to be bookable", async () => {
    const fetchMock = mockFetchSequence({ ok: true, body: [AVAILABLE_RESOURCE] });
    const user = userEvent.setup();
    render(<ServiceEditor merchantId={MERCHANT_ID} />);

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));

    await user.type(screen.getByLabelText("Name"), "Haircut");
    await user.type(screen.getByLabelText("Slug"), "haircut");
    await user.type(screen.getByLabelText("SKU"), "HAIRCUT-STD");
    await user.type(screen.getByLabelText("Variant name"), "Standard haircut");
    await user.type(screen.getByLabelText("Price (minor units)"), "4500");
    await user.type(screen.getByLabelText("Currency"), "USD");
    await user.type(screen.getByLabelText("Duration (minutes)"), "30");

    await user.click(screen.getByRole("button", { name: "Save service" }));

    await screen.findByRole("alert");
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
