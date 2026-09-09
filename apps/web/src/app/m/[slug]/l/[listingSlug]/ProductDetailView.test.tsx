// @vitest-environment jsdom
import { render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ProductDetailView } from "./ProductDetailView";

const SLUG = "acme-rentals";
const LISTING_SLUG = "wool-sweater";

function jsonResponse(ok: boolean, body: unknown, status = 200): Response {
  return { ok, status, json: () => Promise.resolve(body) } as Response;
}

function mockProductDetail(opts: {
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
      attributesJson: string | null;
      stockStatus: string;
    }>;
  };
  status?: number;
}) {
  const fetchMock = vi.fn().mockImplementation((url: string) => {
    if (typeof url === "string" && url.endsWith(`/v1/m/${SLUG}/listings/${LISTING_SLUG}`)) {
      return Promise.resolve(
        jsonResponse(
          (opts.status ?? 200) < 300,
          opts.detail ?? {
            id: "listing-1",
            mode: "PRODUCT",
            name: "Wool Sweater",
            slug: LISTING_SLUG,
            description: "Warm and cozy",
            variants: [],
          },
          opts.status ?? 200,
        ),
      );
    }
    return Promise.reject(new Error(`Unexpected fetch: ${url}`));
  });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("ProductDetailView", () => {
  it("renders the product name, description, and each variant", async () => {
    mockProductDetail({
      detail: {
        id: "listing-1",
        mode: "PRODUCT",
        name: "Wool Sweater",
        slug: LISTING_SLUG,
        description: "Warm and cozy",
        variants: [
          {
            id: "v-1",
            sku: "SWEATER-M",
            name: "Medium",
            priceMinor: 4500,
            currency: "USD",
            attributesJson: null,
            stockStatus: "IN_STOCK",
          },
          {
            id: "v-2",
            sku: "SWEATER-L",
            name: "Large",
            priceMinor: 4500,
            currency: "USD",
            attributesJson: null,
            stockStatus: "OUT_OF_STOCK",
          },
        ],
      },
    });

    render(<ProductDetailView slug={SLUG} listingSlug={LISTING_SLUG} />);

    expect(await screen.findByRole("heading", { name: "Wool Sweater", level: 1 })).toBeInTheDocument();
    expect(screen.getByText("Warm and cozy")).toBeInTheDocument();
    expect(screen.getByText("Medium")).toBeInTheDocument();
    expect(screen.getByText("Large")).toBeInTheDocument();
  });

  it("reflects out-of-stock accurately, per this card's acceptance criterion", async () => {
    mockProductDetail({
      detail: {
        id: "listing-1",
        mode: "PRODUCT",
        name: "Wool Sweater",
        slug: LISTING_SLUG,
        description: null,
        variants: [
          {
            id: "v-2",
            sku: "SWEATER-L",
            name: "Large",
            priceMinor: 4500,
            currency: "USD",
            attributesJson: null,
            stockStatus: "OUT_OF_STOCK",
          },
        ],
      },
    });

    render(<ProductDetailView slug={SLUG} listingSlug={LISTING_SLUG} />);

    await screen.findByText("Large");
    expect(screen.getByText(/out of stock/i)).toBeInTheDocument();
  });

  it("never renders a raw stock count — this card's security check", async () => {
    mockProductDetail({
      detail: {
        id: "listing-1",
        mode: "PRODUCT",
        name: "Wool Sweater",
        slug: LISTING_SLUG,
        description: null,
        variants: [
          {
            id: "v-1",
            sku: "SWEATER-M",
            name: "Medium",
            priceMinor: 4500,
            currency: "USD",
            attributesJson: null,
            stockStatus: "IN_STOCK",
          },
        ],
      },
    });

    render(<ProductDetailView slug={SLUG} listingSlug={LISTING_SLUG} />);

    await screen.findByText("Medium");
    expect(screen.queryByText(/\d+ in stock/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/units? (available|remaining|left)/i)).not.toBeInTheDocument();
  });

  it("shows an error when the product cannot be found", async () => {
    mockProductDetail({ status: 404 });

    render(<ProductDetailView slug={SLUG} listingSlug={LISTING_SLUG} />);

    expect(await screen.findByRole("alert")).toHaveTextContent(/could not.*find/i);
  });
});
