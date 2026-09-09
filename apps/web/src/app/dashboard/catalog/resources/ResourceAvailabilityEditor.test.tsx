// @vitest-environment jsdom
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ResourceAvailabilityEditor } from "./ResourceAvailabilityEditor";

const MERCHANT_ID = "018f1e2a-0000-7000-8000-000000000001";
const LOCATION_ID = "018f1e2a-0000-7000-8000-000000000002";
const RESOURCE_ID = "018f1e2a-0000-7000-8000-000000000003";
const RULE_ID = "018f1e2a-0000-7000-8000-000000000004";

function mockFetchSequence(...responses: Array<{ ok: boolean; body: unknown }>) {
  const fetchMock = vi.fn();
  for (const { ok, body } of responses) {
    fetchMock.mockImplementationOnce(() => Promise.resolve({ ok, json: () => Promise.resolve(body) } as Response));
  }
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

const LOCATION = {
  id: LOCATION_ID,
  merchantId: MERCHANT_ID,
  name: "NY Shop",
  timezone: "America/New_York",
  addressLine1: null,
  addressLine2: null,
  city: null,
  state: null,
  postalCode: null,
  country: null,
  archivedAt: null,
};

const RESOURCE = {
  id: RESOURCE_ID,
  merchantId: MERCHANT_ID,
  locationId: LOCATION_ID,
  kind: "STAFF" as const,
  name: "Jamie Rivera",
  capacity: 1,
  archivedAt: null,
};

const RULE = {
  id: RULE_ID,
  merchantId: MERCHANT_ID,
  resourceId: RESOURCE_ID,
  weekday: 1,
  startTime: "09:00",
  endTime: "17:00",
  validFrom: null,
  validTo: null,
};

describe("ResourceAvailabilityEditor (D112 — Resources and availability editor)", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("loads locations/resources, adds a weekly rule, and renders availability in the resource's own location timezone", async () => {
    const fetchMock = mockFetchSequence(
      { ok: true, body: [LOCATION] }, // GET /locations
      { ok: true, body: [RESOURCE] }, // GET /resources
      { ok: true, body: [] }, // GET /resources/:id/availability-rules (initial)
      { ok: true, body: [] }, // GET /resources/:id/availability-exceptions (initial)
      { ok: true, body: { free: [] } }, // GET /resources/:id/availability (initial)
      { ok: true, body: { id: RULE_ID } }, // POST /resources/:id/availability-rules
      { ok: true, body: [RULE] }, // GET /resources/:id/availability-rules (refetch)
      { ok: true, body: [] }, // GET /resources/:id/availability-exceptions (refetch)
      {
        ok: true,
        body: { free: [{ start: "2027-03-07T14:00:00.000Z", end: "2027-03-07T22:00:00.000Z" }] },
      }, // GET /resources/:id/availability (refetch)
    );
    const user = userEvent.setup();
    render(<ResourceAvailabilityEditor merchantId={MERCHANT_ID} />);

    await screen.findByText("Jamie Rivera");
    expect(await screen.findByText("Timezone: America/New_York")).toBeInTheDocument();

    await user.selectOptions(screen.getByLabelText("Weekday"), "1");
    await user.type(screen.getByLabelText("Start time (HH:MM)"), "09:00");
    await user.type(screen.getByLabelText("End time (HH:MM)"), "17:00");
    await user.click(screen.getByRole("button", { name: "Add weekly rule" }));

    await screen.findByText("09:00");
    expect(screen.getAllByText("Monday").length).toBeGreaterThan(0);
    expect(screen.getByText("17:00")).toBeInTheDocument();

    // Renders the returned UTC instant converted into the resource's own
    // location timezone (America/New_York, EST that week), not raw UTC and
    // not the test runner's local zone — this card's acceptance criterion.
    await screen.findByText(/9:00 AM.*5:00 PM/);

    expect(fetchMock).toHaveBeenNthCalledWith(
      6,
      expect.stringContaining(`/resources/${RESOURCE_ID}/availability-rules`),
      expect.objectContaining({
        method: "POST",
        headers: expect.objectContaining({ "x-merchant-id": MERCHANT_ID }),
        body: JSON.stringify({ weekday: 1, startTime: "09:00", endTime: "17:00" }),
      }),
    );
  });

  it("rejects an incomplete rule client-side and never calls the save fetch", async () => {
    const fetchMock = mockFetchSequence(
      { ok: true, body: [LOCATION] },
      { ok: true, body: [RESOURCE] },
      { ok: true, body: [] },
      { ok: true, body: [] },
      { ok: true, body: { free: [] } },
    );
    const user = userEvent.setup();
    render(<ResourceAvailabilityEditor merchantId={MERCHANT_ID} />);

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(5));

    await user.click(screen.getByRole("button", { name: "Add weekly rule" }));

    await screen.findByRole("alert");
    expect(fetchMock).toHaveBeenCalledTimes(5);
  });

  it("adds a BLACKOUT exception and it appears in the exceptions list — D113 acceptance criterion", async () => {
    const EXCEPTION_ID = "018f1e2a-0000-7000-8000-000000000005";
    const EXCEPTION = {
      id: EXCEPTION_ID,
      merchantId: MERCHANT_ID,
      resourceId: RESOURCE_ID,
      startsAt: "2026-12-25T00:00:00.000Z",
      endsAt: "2026-12-26T00:00:00.000Z",
      kind: "BLACKOUT" as const,
      note: "Holiday",
    };
    const fetchMock = mockFetchSequence(
      { ok: true, body: [LOCATION] }, // GET /locations
      { ok: true, body: [RESOURCE] }, // GET /resources
      { ok: true, body: [] }, // GET /resources/:id/availability-rules (initial)
      { ok: true, body: [] }, // GET /resources/:id/availability-exceptions (initial)
      { ok: true, body: { free: [] } }, // GET /resources/:id/availability (initial)
      { ok: true, body: { id: EXCEPTION_ID } }, // POST /resources/:id/availability-exceptions
      { ok: true, body: [] }, // GET /resources/:id/availability-rules (refetch)
      { ok: true, body: [EXCEPTION] }, // GET /resources/:id/availability-exceptions (refetch)
      { ok: true, body: { free: [] } }, // GET /resources/:id/availability (refetch)
    );
    const user = userEvent.setup();
    render(<ResourceAvailabilityEditor merchantId={MERCHANT_ID} />);

    await screen.findByText("Jamie Rivera");

    await user.selectOptions(screen.getByLabelText("Kind"), "BLACKOUT");
    await user.type(screen.getByLabelText("Starts at (ISO)"), "2026-12-25T00:00:00.000Z");
    await user.type(screen.getByLabelText("Ends at (ISO)"), "2026-12-26T00:00:00.000Z");
    await user.type(screen.getByLabelText("Note (optional)"), "Holiday");
    await user.click(screen.getByRole("button", { name: "Add exception" }));

    await screen.findByText("BLACKOUT");
    expect(screen.getByText("Holiday")).toBeInTheDocument();

    expect(fetchMock).toHaveBeenNthCalledWith(
      6,
      expect.stringContaining(`/resources/${RESOURCE_ID}/availability-exceptions`),
      expect.objectContaining({
        method: "POST",
        headers: expect.objectContaining({ "x-merchant-id": MERCHANT_ID }),
        body: JSON.stringify({
          startsAt: "2026-12-25T00:00:00.000Z",
          endsAt: "2026-12-26T00:00:00.000Z",
          kind: "BLACKOUT",
          note: "Holiday",
        }),
      }),
    );
  });
});
