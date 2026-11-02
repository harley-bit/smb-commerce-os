// @vitest-environment jsdom
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { InventoryUnitsView } from "./InventoryUnitsView";

const MERCHANT_ID = "018f1e2a-0000-7000-8000-000000000001";
const LISTING_ID = "018f1e2a-0000-7000-8000-000000000002";
const VARIANT_ID = "018f1e2a-0000-7000-8000-000000000003";
const UNIT_ID = "018f1e2a-0000-7000-8000-000000000004";
const LOCATION_ID = "018f1e2a-0000-7000-8000-000000000005";

function mockFetchSequence(...responses: Array<{ ok: boolean; body: unknown }>) {
  const fetchMock = vi.fn();
  for (const { ok, body } of responses) {
    fetchMock.mockImplementationOnce(() => Promise.resolve({ ok, json: () => Promise.resolve(body) } as Response));
  }
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

const UNIT = {
  id: UNIT_ID,
  merchantId: MERCHANT_ID,
  variantId: VARIANT_ID,
  locationId: LOCATION_ID,
  unitCode: "SN-001",
  trackingMode: "SERIALIZED",
  status: "AVAILABLE",
  acquisitionCostMinor: 500000,
  acquiredAt: "2026-09-08T00:00:00.000Z",
  expectedLifeMonths: 36,
  conditionGrade: "A",
  retiredAt: null,
  rentalStatus: "AVAILABLE",
  returnDueAt: null,
};

describe("InventoryUnitsView (D110 — Inventory unit management)", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("loads units, edits a row, and renders the server's read-back — units tracked individually", async () => {
    const fetchMock = mockFetchSequence(
      { ok: true, body: [UNIT] },
      { ok: true, body: { id: UNIT_ID } },
      { ok: true, body: [{ ...UNIT, conditionGrade: "B" }] },
    );
    const user = userEvent.setup();
    render(<InventoryUnitsView merchantId={MERCHANT_ID} listingId={LISTING_ID} variantId={VARIANT_ID} />);

    const gradeInput = await screen.findByLabelText(`Condition grade for ${UNIT_ID}`);
    await user.clear(gradeInput);
    await user.type(gradeInput, "B");

    await user.click(screen.getByRole("button", { name: "Save changes" }));

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(3));
    expect(fetchMock).toHaveBeenNthCalledWith(
      2,
      expect.stringContaining(`/listings/${LISTING_ID}/variants/${VARIANT_ID}/units/${UNIT_ID}`),
      expect.objectContaining({
        method: "PUT",
        headers: expect.objectContaining({ "x-merchant-id": MERCHANT_ID }),
        body: expect.stringContaining('"conditionGrade":"B"'),
      }),
    );

    await waitFor(async () => {
      expect(await screen.findByLabelText(`Condition grade for ${UNIT_ID}`)).toHaveValue("B");
    });
  });

  it("this card's security check — an edit payload never carries acquisitionCostMinor/acquiredAt", async () => {
    const fetchMock = mockFetchSequence(
      { ok: true, body: [UNIT] },
      { ok: true, body: { id: UNIT_ID } },
      { ok: true, body: [UNIT] },
    );
    const user = userEvent.setup();
    render(<InventoryUnitsView merchantId={MERCHANT_ID} listingId={LISTING_ID} variantId={VARIANT_ID} />);

    const unitCodeInput = await screen.findByLabelText(`Unit code for ${UNIT_ID}`);
    await user.clear(unitCodeInput);
    await user.type(unitCodeInput, "SN-001-RELABELED");
    await user.click(screen.getByRole("button", { name: "Save changes" }));

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(3));
    const putCall = fetchMock.mock.calls[1] as [string, { body: string }];
    expect(putCall[1].body).not.toContain("acquisitionCostMinor");
    expect(putCall[1].body).not.toContain("acquiredAt");
  });

  it("adds a unit with acquisition data captured up front", async () => {
    const fetchMock = mockFetchSequence(
      { ok: true, body: [] },
      { ok: true, body: { id: UNIT_ID } },
      { ok: true, body: [UNIT] },
    );
    const user = userEvent.setup();
    render(<InventoryUnitsView merchantId={MERCHANT_ID} listingId={LISTING_ID} variantId={VARIANT_ID} />);

    await screen.findByText("No units tracked for this variant yet.");
    await user.type(screen.getByLabelText("New unit code"), "SN-002");
    await user.type(screen.getByLabelText("Location id"), LOCATION_ID);
    await user.type(screen.getByLabelText("Acquisition cost (minor units)"), "500000");
    await user.type(screen.getByLabelText("Acquired at"), "2026-09-08T00:00:00.000Z");

    await user.click(screen.getByRole("button", { name: "Add unit" }));

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(3));
    const postCall = fetchMock.mock.calls[1] as [string, { body: string }];
    expect(postCall[1].body).toContain('"acquisitionCostMinor":500000');
    expect(postCall[1].body).toContain('"acquiredAt":"2026-09-08T00:00:00.000Z"');
  });

  it("rejects adding a unit missing acquisition cost client-side and fires no POST", async () => {
    mockFetchSequence({ ok: true, body: [] });
    const user = userEvent.setup();
    render(<InventoryUnitsView merchantId={MERCHANT_ID} listingId={LISTING_ID} variantId={VARIANT_ID} />);

    await screen.findByText("No units tracked for this variant yet.");
    await user.type(screen.getByLabelText("New unit code"), "SN-002");
    await user.type(screen.getByLabelText("Location id"), LOCATION_ID);
    await user.type(screen.getByLabelText("Acquired at"), "2026-09-08T00:00:00.000Z");

    const fetchMock = vi.fn(async () => ({ ok: true, json: async () => [] }) as Response);
    vi.stubGlobal("fetch", fetchMock);

    await user.click(screen.getByRole("button", { name: "Add unit" }));

    await screen.findByRole("alert");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("retires an available unit", async () => {
    const fetchMock = mockFetchSequence(
      { ok: true, body: [UNIT] },
      { ok: true, body: { id: UNIT_ID } },
      { ok: true, body: [{ ...UNIT, status: "RETIRED" }] },
    );
    const user = userEvent.setup();
    render(<InventoryUnitsView merchantId={MERCHANT_ID} listingId={LISTING_ID} variantId={VARIANT_ID} />);

    await screen.findByLabelText(`Unit code for ${UNIT_ID}`);
    await user.click(screen.getByRole("button", { name: "Retire" }));

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(3));
    expect(fetchMock).toHaveBeenNthCalledWith(
      2,
      expect.stringContaining(`/listings/${LISTING_ID}/variants/${VARIANT_ID}/units/${UNIT_ID}/retire`),
      expect.objectContaining({ method: "POST" }),
    );

    await screen.findByText("RETIRED");
  });

  it("disables Retire for an already-RETIRED unit", async () => {
    mockFetchSequence({ ok: true, body: [{ ...UNIT, status: "RETIRED" }] });
    render(<InventoryUnitsView merchantId={MERCHANT_ID} listingId={LISTING_ID} variantId={VARIANT_ID} />);

    await screen.findByLabelText(`Unit code for ${UNIT_ID}`);
    expect(screen.getByRole("button", { name: "Retire" })).toBeDisabled();
  });

  describe("rental status — docs/cards/D111.md", () => {
    it("this card's deliverable: shows out-on-rental with its return date", async () => {
      mockFetchSequence({
        ok: true,
        body: [{ ...UNIT, rentalStatus: "OUT_ON_RENTAL", returnDueAt: "2026-10-05T10:00:00.000Z" }],
      });
      render(<InventoryUnitsView merchantId={MERCHANT_ID} listingId={LISTING_ID} variantId={VARIANT_ID} />);

      await screen.findByLabelText(`Unit code for ${UNIT_ID}`);
      expect(screen.getByText(/Out on rental/)).toBeInTheDocument();
      expect(screen.getByText(/2026-10-05T10:00:00.000Z/)).toBeInTheDocument();
    });

    it("this card's acceptance criterion: an out-on-rental unit is visibly unavailable for sale — retire disabled too", async () => {
      mockFetchSequence({
        ok: true,
        body: [{ ...UNIT, rentalStatus: "OUT_ON_RENTAL", returnDueAt: "2026-10-05T10:00:00.000Z" }],
      });
      render(<InventoryUnitsView merchantId={MERCHANT_ID} listingId={LISTING_ID} variantId={VARIANT_ID} />);

      await screen.findByLabelText(`Unit code for ${UNIT_ID}`);
      expect(screen.getByText(/unavailable for sale/i)).toBeInTheDocument();
      expect(screen.getByRole("button", { name: "Retire" })).toBeDisabled();
    });

    it("shows a plain Available status with no return date when nothing is currently blocking the unit", async () => {
      mockFetchSequence({ ok: true, body: [UNIT] });
      render(<InventoryUnitsView merchantId={MERCHANT_ID} listingId={LISTING_ID} variantId={VARIANT_ID} />);

      await screen.findByLabelText(`Unit code for ${UNIT_ID}`);
      expect(screen.queryByText(/Out on rental/)).not.toBeInTheDocument();
      expect(screen.getByRole("button", { name: "Retire" })).not.toBeDisabled();
    });
  });
});
