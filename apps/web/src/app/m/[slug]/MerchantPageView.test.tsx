// @vitest-environment jsdom
import { render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { MerchantPageView } from "./MerchantPageView";

const SLUG = "acme-rentals";

function jsonResponse(ok: boolean, body: unknown, status = 200): Response {
  return { ok, status, json: () => Promise.resolve(body) } as Response;
}

function mockStorefront(opts: {
  profile?: { name: string; slug: string; defaultCurrency: string };
  listings?: Array<{ id: string; mode: string; name: string; slug: string; description: string | null }>;
  profileStatus?: number;
}) {
  const fetchMock = vi.fn().mockImplementation((url: string) => {
    if (typeof url === "string" && url.endsWith(`/v1/m/${SLUG}`)) {
      return Promise.resolve(
        jsonResponse(
          (opts.profileStatus ?? 200) < 300,
          opts.profile ?? { name: "Acme Rentals", slug: SLUG, defaultCurrency: "USD" },
          opts.profileStatus ?? 200,
        ),
      );
    }
    if (typeof url === "string" && url.endsWith(`/v1/m/${SLUG}/listings`)) {
      return Promise.resolve(jsonResponse(true, opts.listings ?? []));
    }
    return Promise.reject(new Error(`Unexpected fetch: ${url}`));
  });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("MerchantPageView", () => {
  it("renders all three catalog modes on one page", async () => {
    mockStorefront({
      listings: [
        { id: "l-1", mode: "PRODUCT", name: "Wool Sweater", slug: "wool-sweater", description: null },
        { id: "l-2", mode: "SERVICE", name: "Haircut", slug: "haircut", description: null },
        { id: "l-3", mode: "RENTAL", name: "Camping Tent", slug: "camping-tent", description: null },
      ],
    });

    render(<MerchantPageView slug={SLUG} />);

    expect(await screen.findByText("Wool Sweater")).toBeInTheDocument();
    expect(screen.getByText("Haircut")).toBeInTheDocument();
    expect(screen.getByText("Camping Tent")).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Products" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Services" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Rentals" })).toBeInTheDocument();
  });

  it("renders the merchant name from the public profile", async () => {
    mockStorefront({ profile: { name: "Acme Rentals", slug: SLUG, defaultCurrency: "USD" }, listings: [] });

    render(<MerchantPageView slug={SLUG} />);

    expect(await screen.findByRole("heading", { name: "Acme Rentals", level: 1 })).toBeInTheDocument();
  });

  it("shows an empty-state message for a mode with no published listings", async () => {
    mockStorefront({
      listings: [{ id: "l-1", mode: "PRODUCT", name: "Wool Sweater", slug: "wool-sweater", description: null }],
    });

    render(<MerchantPageView slug={SLUG} />);

    await screen.findByText("Wool Sweater");
    expect(screen.getAllByText("Nothing here yet.")).toHaveLength(2);
  });

  it("shows an error when the merchant cannot be found", async () => {
    mockStorefront({ profileStatus: 404 });

    render(<MerchantPageView slug={SLUG} />);

    expect(await screen.findByRole("alert")).toHaveTextContent(/could not.*find/i);
  });

  it("links a product listing to its detail page, per D122", async () => {
    mockStorefront({
      listings: [{ id: "l-1", mode: "PRODUCT", name: "Wool Sweater", slug: "wool-sweater", description: null }],
    });

    render(<MerchantPageView slug={SLUG} />);

    const link = await screen.findByRole("link", { name: "Wool Sweater" });
    expect(link).toHaveAttribute("href", `/m/${SLUG}/l/wool-sweater`);
  });

  it("does not link a service or rental listing — no detail page exists for those yet", async () => {
    mockStorefront({
      listings: [
        { id: "l-2", mode: "SERVICE", name: "Haircut", slug: "haircut", description: null },
        { id: "l-3", mode: "RENTAL", name: "Camping Tent", slug: "camping-tent", description: null },
      ],
    });

    render(<MerchantPageView slug={SLUG} />);

    await screen.findByText("Haircut");
    expect(screen.queryByRole("link", { name: "Haircut" })).not.toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "Camping Tent" })).not.toBeInTheDocument();
  });
});
