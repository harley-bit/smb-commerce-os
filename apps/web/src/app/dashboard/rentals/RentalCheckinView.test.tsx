// @vitest-environment jsdom
import { fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { RentalCheckinView } from "./RentalCheckinView";

const MERCHANT_ID = "018f1e2a-0000-7000-8000-000000000002";
const ORDER_LINE_ID = "018f1e2a-0000-7000-8000-000000000031";
const CHECKIN_REPORT_ID = "018f1e2a-0000-7000-8000-000000000033";

function jsonResponse(ok: boolean, body: unknown, status = 200): Response {
  return { ok, status, json: () => Promise.resolve(body) } as Response;
}

const CHECKOUT_ONLY_COMPARISON = {
  checkoutReport: {
    id: "018f1e2a-0000-7000-8000-000000000032",
    conditionGrade: "GOOD",
    notes: "No visible damage at pickup.",
    media: [{ id: "media-1", storageKey: "condition-media/checkout-1", sha256: "a".repeat(64) }],
  },
  checkinReport: null,
  delta: null,
};

describe("RentalCheckinView (D117 — Rental check-in flow)", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("loads and shows the CHECKOUT baseline's grade and its server-verified media hash", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(true, CHECKOUT_ONLY_COMPARISON));
    vi.stubGlobal("fetch", fetchMock);
    vi.stubGlobal("crypto", { subtle: { digest: vi.fn() } });

    render(<RentalCheckinView merchantId={MERCHANT_ID} orderLineId={ORDER_LINE_ID} />);

    await screen.findByText("GOOD", { selector: "td" });
    expect(screen.getByText(/Hash verified at checkout: a{12}/)).toBeInTheDocument();
  });

  it("disables Complete return until a CHECKIN condition report has been recorded — this card's acceptance criterion", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse(true, CHECKOUT_ONLY_COMPARISON)));

    render(<RentalCheckinView merchantId={MERCHANT_ID} orderLineId={ORDER_LINE_ID} />);

    await screen.findByRole("button", { name: "Save check-in report" });
    expect(screen.getByRole("button", { name: "Complete return" })).toBeDisabled();
  });

  it("surfaces the grade delta once a CHECKIN report is recorded, and completes the return — this card's acceptance criterion", async () => {
    const comparisonAfterCheckin = {
      checkoutReport: CHECKOUT_ONLY_COMPARISON.checkoutReport,
      checkinReport: { id: CHECKIN_REPORT_ID, conditionGrade: "FAIR", notes: null, media: [] },
      delta: { checkoutGrade: "GOOD", checkinGrade: "FAIR", deltaSteps: -1, deteriorated: true, improved: false, unchanged: false },
    };

    let checkinRecorded = false;
    const fetchMock = vi.fn().mockImplementation((url: string, init?: RequestInit) => {
      if (typeof url === "string" && url.endsWith("/condition-reports") && (!init || init.method === undefined)) {
        return Promise.resolve(jsonResponse(true, checkinRecorded ? comparisonAfterCheckin : CHECKOUT_ONLY_COMPARISON));
      }
      if (typeof url === "string" && url.endsWith("/condition-reports/checkin") && init?.method === "POST") {
        checkinRecorded = true;
        return Promise.resolve(jsonResponse(true, { checkinReportId: CHECKIN_REPORT_ID }, 201));
      }
      if (typeof url === "string" && url.endsWith("/return") && init?.method === "POST") {
        return Promise.resolve(jsonResponse(true, { id: "event-1" }, 201));
      }
      return Promise.reject(new Error(`Unexpected fetch: ${url}`));
    });
    vi.stubGlobal("fetch", fetchMock);

    render(<RentalCheckinView merchantId={MERCHANT_ID} orderLineId={ORDER_LINE_ID} />);

    fireEvent.change(await screen.findByLabelText("Inventory unit"), { target: { value: "unit-1" } });
    fireEvent.click(screen.getByRole("button", { name: "Save check-in report" }));

    await screen.findByText(/Grade delta: Deteriorated \(GOOD → FAIR\)/);
    expect(screen.getByRole("button", { name: "Complete return" })).not.toBeDisabled();

    fireEvent.click(screen.getByRole("button", { name: "Complete return" }));

    await screen.findByText("Returned — the unit is now available for the next booking.");
  });

  it("surfaces a 409 from the checkin endpoint as an explicit error", async () => {
    const fetchMock = vi.fn().mockImplementation((url: string, init?: RequestInit) => {
      if (typeof url === "string" && url.endsWith("/condition-reports") && (!init || init.method === undefined)) {
        return Promise.resolve(jsonResponse(true, { checkoutReport: null, checkinReport: null, delta: null }));
      }
      if (typeof url === "string" && url.endsWith("/condition-reports/checkin") && init?.method === "POST") {
        return Promise.resolve(jsonResponse(false, {}, 409));
      }
      return Promise.reject(new Error(`Unexpected fetch: ${url}`));
    });
    vi.stubGlobal("fetch", fetchMock);

    render(<RentalCheckinView merchantId={MERCHANT_ID} orderLineId={ORDER_LINE_ID} />);

    fireEvent.change(await screen.findByLabelText("Inventory unit"), { target: { value: "unit-1" } });
    fireEvent.click(screen.getByRole("button", { name: "Save check-in report" }));

    await screen.findByRole("alert");
    expect(
      screen.getByText("A CHECKOUT condition report is required before a CHECKIN can be recorded."),
    ).toBeInTheDocument();
  });
});
