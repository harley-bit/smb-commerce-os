// @vitest-environment jsdom
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { RentalDetailView } from "./RentalDetailView";

const SLUG = "acme-rentals";
const LISTING_SLUG = "camping-tent";
const VARIANT_ID = "variant-1";

function jsonResponse(ok: boolean, body: unknown, status = 200): Response {
  return { ok, status, json: () => Promise.resolve(body) } as Response;
}

function mockRentalDetail(opts: {
  detail?: {
    id: string;
    mode: string;
    name: string;
    slug: string;
    description: string | null;
    variants: Array<{
      id: string;
      sku: string;
      name: string;
      priceMinor: number;
      currency: string;
      ratePeriod: string | null;
      depositMinor: number | null;
    }>;
  };
  detailStatus?: number;
  available?: boolean;
}) {
  const detail = opts.detail ?? {
    id: "listing-1",
    mode: "RENTAL",
    name: "Camping Tent",
    slug: LISTING_SLUG,
    description: "A roomy 4-person tent",
    variants: [
      {
        id: VARIANT_ID,
        sku: "TENT-4P",
        name: "4-person tent",
        priceMinor: 3500,
        currency: "USD",
        ratePeriod: "DAY",
        depositMinor: 15000,
      },
    ],
  };
  const fetchMock = vi.fn().mockImplementation((url: string) => {
    if (typeof url === "string" && url.endsWith(`/v1/m/${SLUG}/listings/${LISTING_SLUG}`)) {
      return Promise.resolve(jsonResponse((opts.detailStatus ?? 200) < 300, detail, opts.detailStatus ?? 200));
    }
    if (typeof url === "string" && url.includes(`/v1/m/${SLUG}/listings/${LISTING_SLUG}/rental-availability`)) {
      return Promise.resolve(jsonResponse(true, { available: opts.available ?? true }));
    }
    return Promise.reject(new Error(`Unexpected fetch: ${url}`));
  });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("RentalDetailView", () => {
  it("renders the rental name and description", async () => {
    mockRentalDetail({});

    render(<RentalDetailView slug={SLUG} listingSlug={LISTING_SLUG} />);

    expect(await screen.findByRole("heading", { name: "Camping Tent", level: 1 })).toBeInTheDocument();
    expect(screen.getByText("A roomy 4-person tent")).toBeInTheDocument();
  });

  it("discloses the deposit amount before any date range is picked — this card's security check", async () => {
    mockRentalDetail({});

    render(<RentalDetailView slug={SLUG} listingSlug={LISTING_SLUG} />);

    await screen.findByRole("heading", { name: "Camping Tent" });
    expect(screen.getByText(/150\.00 USD/)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /reserve/i })).not.toBeInTheDocument();
  });

  it("blocks an unavailable date range — this card's acceptance criterion", async () => {
    const user = userEvent.setup();
    mockRentalDetail({ available: false });

    render(<RentalDetailView slug={SLUG} listingSlug={LISTING_SLUG} />);

    await screen.findByRole("heading", { name: "Camping Tent" });
    await user.type(screen.getByLabelText(/start date/i), "2026-10-01");
    await user.type(screen.getByLabelText(/end date/i), "2026-10-05");

    expect(await screen.findByText(/not available/i)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /reserve/i })).not.toBeInTheDocument();
  });

  it("lets an available date range be selected", async () => {
    const user = userEvent.setup();
    mockRentalDetail({ available: true });

    render(<RentalDetailView slug={SLUG} listingSlug={LISTING_SLUG} />);

    await screen.findByRole("heading", { name: "Camping Tent" });
    await user.type(screen.getByLabelText(/start date/i), "2026-10-01");
    await user.type(screen.getByLabelText(/end date/i), "2026-10-05");

    const reserveButton = await screen.findByRole("button", { name: /reserve/i });
    expect(reserveButton).toHaveAttribute("aria-pressed", "false");

    await user.click(reserveButton);

    expect(reserveButton).toHaveAttribute("aria-pressed", "true");
  });

  it("shows a message when the rental has no variants configured yet", async () => {
    mockRentalDetail({
      detail: {
        id: "listing-1",
        mode: "RENTAL",
        name: "Camping Tent",
        slug: LISTING_SLUG,
        description: null,
        variants: [],
      },
    });

    render(<RentalDetailView slug={SLUG} listingSlug={LISTING_SLUG} />);

    await screen.findByText(/no rental options/i);
  });

  it("shows an error when the rental cannot be found", async () => {
    mockRentalDetail({ detailStatus: 404 });

    render(<RentalDetailView slug={SLUG} listingSlug={LISTING_SLUG} />);

    expect(await screen.findByRole("alert")).toHaveTextContent(/could not.*find/i);
  });
});
