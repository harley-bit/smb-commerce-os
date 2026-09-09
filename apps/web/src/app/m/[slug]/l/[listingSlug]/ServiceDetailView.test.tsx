// @vitest-environment jsdom
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ServiceDetailView } from "./ServiceDetailView";
import { computeMonthWindow, monthLabel } from "./availabilityWindow";

const SLUG = "acme-rentals";
const LISTING_SLUG = "haircut";
const RESOURCE_ID = "resource-1";

function jsonResponse(ok: boolean, body: unknown, status = 200): Response {
  return { ok, status, json: () => Promise.resolve(body) } as Response;
}

function mockServiceDetail(opts: {
  detail?: {
    id: string;
    mode: string;
    name: string;
    slug: string;
    description: string | null;
    resourceIds: string[];
  };
  detailStatus?: number;
  free?: Array<{ start: string; end: string }>;
}) {
  const detail = opts.detail ?? {
    id: "listing-1",
    mode: "SERVICE",
    name: "Haircut",
    slug: LISTING_SLUG,
    description: "A fresh cut",
    resourceIds: [RESOURCE_ID],
  };
  const fetchMock = vi.fn().mockImplementation((url: string) => {
    if (typeof url === "string" && url.endsWith(`/v1/m/${SLUG}/listings/${LISTING_SLUG}`)) {
      return Promise.resolve(jsonResponse((opts.detailStatus ?? 200) < 300, detail, opts.detailStatus ?? 200));
    }
    if (typeof url === "string" && url.includes(`/v1/m/${SLUG}/availability`)) {
      return Promise.resolve(jsonResponse(true, { free: opts.free ?? [] }));
    }
    return Promise.reject(new Error(`Unexpected fetch: ${url}`));
  });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("ServiceDetailView", () => {
  it("renders the service name and description", async () => {
    mockServiceDetail({ free: [] });

    render(<ServiceDetailView slug={SLUG} listingSlug={LISTING_SLUG} />);

    expect(await screen.findByRole("heading", { name: "Haircut", level: 1 })).toBeInTheDocument();
    expect(screen.getByText("A fresh cut")).toBeInTheDocument();
  });

  it("renders only the free intervals as selectable slots — this card's acceptance criterion", async () => {
    mockServiceDetail({
      free: [
        { start: "2026-09-10T09:00:00.000Z", end: "2026-09-10T10:00:00.000Z" },
        { start: "2026-09-10T14:00:00.000Z", end: "2026-09-10T15:00:00.000Z" },
      ],
    });

    render(<ServiceDetailView slug={SLUG} listingSlug={LISTING_SLUG} />);

    const slots = await screen.findAllByRole("button", { name: /2026-09-10/ });
    expect(slots).toHaveLength(2);
  });

  it("lets a free slot be selected", async () => {
    const user = userEvent.setup();
    mockServiceDetail({
      free: [{ start: "2026-09-10T09:00:00.000Z", end: "2026-09-10T10:00:00.000Z" }],
    });

    render(<ServiceDetailView slug={SLUG} listingSlug={LISTING_SLUG} />);

    const slot = await screen.findByRole("button", { name: /2026-09-10/ });
    expect(slot).toHaveAttribute("aria-pressed", "false");

    await user.click(slot);

    expect(slot).toHaveAttribute("aria-pressed", "true");
  });

  it("lets a free slot be selected via keyboard alone, with no mouse click — D135", async () => {
    const user = userEvent.setup();
    mockServiceDetail({
      free: [{ start: "2026-09-10T09:00:00.000Z", end: "2026-09-10T10:00:00.000Z" }],
    });

    render(<ServiceDetailView slug={SLUG} listingSlug={LISTING_SLUG} />);

    const slot = await screen.findByRole("button", { name: /2026-09-10/ });
    expect(slot).toHaveAttribute("aria-pressed", "false");

    for (let i = 0; i < 10 && document.activeElement !== slot; i++) {
      await user.tab();
    }
    expect(slot).toHaveFocus();

    await user.keyboard("{Enter}");

    expect(slot).toHaveAttribute("aria-pressed", "true");
  });

  it("shows no selectable slots when nothing is free", async () => {
    mockServiceDetail({ free: [] });

    render(<ServiceDetailView slug={SLUG} listingSlug={LISTING_SLUG} />);

    await screen.findByRole("heading", { name: "Haircut" });
    expect(screen.getByText(/no.*available/i)).toBeInTheDocument();
    // Month-navigation buttons (D125) are expected even with no free slots;
    // only slot buttons (their name carries the "start–end UTC" label) must
    // be absent.
    expect(screen.queryByRole("button", { name: /–.*UTC/ })).not.toBeInTheDocument();
  });

  it("shows a message when the service has no resource assigned yet, without calling availability", async () => {
    const fetchMock = mockServiceDetail({
      detail: {
        id: "listing-1",
        mode: "SERVICE",
        name: "Haircut",
        slug: LISTING_SLUG,
        description: null,
        resourceIds: [],
      },
    });

    render(<ServiceDetailView slug={SLUG} listingSlug={LISTING_SLUG} />);

    await screen.findByText(/no.*available/i);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("never renders who booked a busy slot — this card's security check", async () => {
    mockServiceDetail({
      free: [{ start: "2026-09-10T09:00:00.000Z", end: "2026-09-10T10:00:00.000Z" }],
    });

    render(<ServiceDetailView slug={SLUG} listingSlug={LISTING_SLUG} />);

    await screen.findByRole("button", { name: /2026-09-10/ });
    expect(screen.queryByText(/booked by/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/customer/i)).not.toBeInTheDocument();
  });

  it("shows an error when the service cannot be found", async () => {
    mockServiceDetail({ detailStatus: 404 });

    render(<ServiceDetailView slug={SLUG} listingSlug={LISTING_SLUG} />);

    expect(await screen.findByRole("alert")).toHaveTextContent(/could not.*find/i);
  });

  it("shows month navigation and refetches availability for the navigated month — D125 deliverable", async () => {
    const user = userEvent.setup();
    const fetchMock = mockServiceDetail({ free: [] });

    render(<ServiceDetailView slug={SLUG} listingSlug={LISTING_SLUG} />);

    const now = new Date();
    await screen.findByText(monthLabel(computeMonthWindow(now, 0).windowStart));

    await user.click(screen.getByRole("button", { name: /next month/i }));

    await screen.findByText(monthLabel(computeMonthWindow(now, 1).windowStart));

    const availabilityCalls = fetchMock.mock.calls.filter(
      ([url]) => typeof url === "string" && url.includes("/availability"),
    );
    expect(availabilityCalls).toHaveLength(2);
  });

  it("disables Previous month on the initial month", async () => {
    mockServiceDetail({ free: [] });

    render(<ServiceDetailView slug={SLUG} listingSlug={LISTING_SLUG} />);

    expect(await screen.findByRole("button", { name: /previous month/i })).toBeDisabled();
  });

  it("disables Next month once navigating further would exceed the 90-day cap — this card's security check", async () => {
    const user = userEvent.setup();
    mockServiceDetail({ free: [] });

    render(<ServiceDetailView slug={SLUG} listingSlug={LISTING_SLUG} />);

    const nextButton = await screen.findByRole("button", { name: /next month/i });
    for (let i = 0; i < 6 && !(nextButton as HTMLButtonElement).disabled; i += 1) {
      await user.click(nextButton);
    }

    expect(nextButton).toBeDisabled();
  });
});
