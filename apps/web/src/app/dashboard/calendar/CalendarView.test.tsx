// @vitest-environment jsdom
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CalendarView } from "./CalendarView";

const MERCHANT_ID = "018f1e2a-0000-7000-8000-000000000002";

const ENTRIES = [
  {
    id: "018f1e2a-0000-7000-8000-000000000010",
    subjectType: "RESOURCE" as const,
    subjectId: "018f1e2a-0000-7000-8000-000000000020",
    subjectLabel: "Jane",
    startsAt: "2026-10-01T09:00:00.000Z",
    endsAt: "2026-10-01T10:00:00.000Z",
    state: "CONFIRMED" as const,
    orderLineId: null,
    hasConflict: false,
    expiresAt: null,
  },
  {
    id: "018f1e2a-0000-7000-8000-000000000011",
    subjectType: "INVENTORY_UNIT" as const,
    subjectId: "018f1e2a-0000-7000-8000-000000000021",
    subjectLabel: "KAYAK-001",
    startsAt: "2026-10-01T11:00:00.000Z",
    endsAt: "2026-10-01T12:00:00.000Z",
    state: "HELD" as const,
    orderLineId: null,
    hasConflict: true,
    expiresAt: null,
  },
];

function mockFetchOnce(ok: boolean, body: unknown) {
  const fetchMock = vi.fn().mockResolvedValue({ ok, json: () => Promise.resolve(body) } as Response);
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

describe("CalendarView (D114 — Unified calendar)", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("fetches the calendar scoped to the caller's merchant via X-Merchant-Id", async () => {
    const fetchMock = mockFetchOnce(true, ENTRIES);
    render(<CalendarView merchantId={MERCHANT_ID} />);

    await screen.findByText("Jane");
    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringContaining("/calendar"),
      expect.objectContaining({ headers: { "x-merchant-id": MERCHANT_ID } }),
    );
  });

  it("shows both a RESOURCE booking and an INVENTORY_UNIT rental together — this card's acceptance criterion", async () => {
    mockFetchOnce(true, ENTRIES);
    render(<CalendarView merchantId={MERCHANT_ID} />);

    await screen.findByText("Jane");
    expect(screen.getByText("KAYAK-001")).toBeInTheDocument();
  });

  it("highlights the conflicting entry and not the clean one", async () => {
    mockFetchOnce(true, ENTRIES);
    render(<CalendarView merchantId={MERCHANT_ID} />);

    await screen.findByText("Jane");
    const rows = screen.getAllByRole("row");
    const conflictRow = rows.find((row) => row.textContent?.includes("KAYAK-001"));
    const cleanRow = rows.find((row) => row.textContent?.includes("Jane"));
    expect(conflictRow?.textContent).toContain("Conflict");
    expect(cleanRow?.textContent).not.toContain("Conflict");
  });

  it("filters by mode", async () => {
    mockFetchOnce(true, ENTRIES);
    const user = userEvent.setup();
    render(<CalendarView merchantId={MERCHANT_ID} />);

    await screen.findByText("Jane");
    await user.selectOptions(screen.getByLabelText("Mode"), "RESOURCE");

    expect(screen.getByText("Jane")).toBeInTheDocument();
    expect(screen.queryByText("KAYAK-001")).not.toBeInTheDocument();
  });

  it("surfaces a load failure without crashing", async () => {
    mockFetchOnce(false, {});
    render(<CalendarView merchantId={MERCHANT_ID} />);

    await screen.findByRole("alert");
  });

  it("shows an empty state when no entries are in range", async () => {
    mockFetchOnce(true, []);
    render(<CalendarView merchantId={MERCHANT_ID} />);

    await screen.findByText(/No bookings or rentals/);
  });

  it("re-fetches when the date range inputs change", async () => {
    const fetchMock = mockFetchOnce(true, ENTRIES);
    const user = userEvent.setup();
    render(<CalendarView merchantId={MERCHANT_ID} />);

    await screen.findByText("Jane");
    const initialCalls = fetchMock.mock.calls.length;

    await user.clear(screen.getByLabelText("From"));
    await user.type(screen.getByLabelText("From"), "2026-11-01");

    await waitFor(() => {
      expect(fetchMock.mock.calls.length).toBeGreaterThan(initialCalls);
    });
  });

  describe("hold countdown (D127)", () => {
    const HELD_RESOURCE_ENTRY = {
      id: "018f1e2a-0000-7000-8000-000000000030",
      subjectType: "RESOURCE" as const,
      subjectId: "018f1e2a-0000-7000-8000-000000000031",
      subjectLabel: "Priya",
      startsAt: "2026-10-01T09:00:00.000Z",
      endsAt: "2026-10-01T10:00:00.000Z",
      state: "HELD" as const,
      orderLineId: null,
      hasConflict: false,
      expiresAt: "2026-10-01T00:05:00.000Z",
    };

    beforeEach(() => {
      vi.useFakeTimers({ shouldAdvanceTime: true });
      vi.setSystemTime(new Date("2026-10-01T00:00:00.000Z"));
    });

    afterEach(() => {
      vi.useRealTimers();
    });

    it("shows a live countdown for a HELD hold, ticking down toward zero", async () => {
      mockFetchOnce(true, [HELD_RESOURCE_ENTRY]);
      render(<CalendarView merchantId={MERCHANT_ID} />);

      await screen.findByText("Priya");
      expect(screen.getByText("5:00 remaining")).toBeInTheDocument();

      await vi.advanceTimersByTimeAsync(60_000);
      expect(screen.getByText("4:00 remaining")).toBeInTheDocument();
    });

    it("shows a clear, recoverable expired message and disables Confirm once the countdown reaches zero — no crash (this card's acceptance criterion)", async () => {
      mockFetchOnce(true, [HELD_RESOURCE_ENTRY]);
      render(<CalendarView merchantId={MERCHANT_ID} />);

      await screen.findByText("Priya");
      await vi.advanceTimersByTimeAsync(5 * 60_000);

      expect(await screen.findByText(/hold has expired/i)).toBeInTheDocument();
      expect(screen.getByRole("button", { name: "Confirm" })).toBeDisabled();
    });

    it("confirming a hold the server has already expired shows the clear, recoverable error instead of crashing (security check)", async () => {
      const fetchMock = vi.fn().mockImplementation((url: string) => {
        if (typeof url === "string" && url.includes("/calendar")) {
          return Promise.resolve({ ok: true, json: () => Promise.resolve([HELD_RESOURCE_ENTRY]) } as Response);
        }
        return Promise.resolve({
          ok: false,
          status: 409,
          json: () => Promise.resolve({ detail: "This hold has expired. Please create a new booking." }),
        } as Response);
      });
      vi.stubGlobal("fetch", fetchMock);
      const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });

      render(<CalendarView merchantId={MERCHANT_ID} />);
      await screen.findByText("Priya");

      await user.click(screen.getByRole("button", { name: "Confirm" }));

      expect(await screen.findByText("This hold has expired. Please create a new booking.")).toBeInTheDocument();
    });
  });
});
