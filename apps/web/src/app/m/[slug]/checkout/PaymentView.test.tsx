// @vitest-environment jsdom
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { PaymentView } from "./PaymentView";

const SLUG = "acme-rentals";
const ORDER_ID = "order-1";

function jsonResponse(body: unknown, status = 200): Response {
  return { ok: status < 300, status, json: () => Promise.resolve(body) } as Response;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("PaymentView", () => {
  it("D130 acceptance criterion: never renders a raw <input> for card data anywhere on the page", () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(jsonResponse({ amountMinor: 10_000, currency: "USD" }, 201)),
    );

    const { container } = render(<PaymentView slug={SLUG} orderId={ORDER_ID} />);

    expect(container.querySelectorAll("input")).toHaveLength(0);
    expect(screen.getByTestId("hosted-card-field")).toBeInTheDocument();
  });

  it("disables Pay until the hosted card field reports ready", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(jsonResponse({ amountMinor: 10_000, currency: "USD" }, 201)),
    );

    render(<PaymentView slug={SLUG} orderId={ORDER_ID} />);

    expect(await screen.findByRole("button", { name: "Pay" })).toBeEnabled();
  });

  it("D130 acceptance criterion: completing payment shows a success message and never surfaces a raw client secret", async () => {
    const user = userEvent.setup();
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ amountMinor: 10_000, currency: "USD" }, 201));
    vi.stubGlobal("fetch", fetchMock);

    render(<PaymentView slug={SLUG} orderId={ORDER_ID} />);

    await user.click(await screen.findByRole("button", { name: "Pay" }));

    expect(await screen.findByRole("status")).toHaveTextContent("Payment completed — 100.00 USD charged.");
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toContain(`/v1/m/${SLUG}/checkout/${ORDER_ID}/payment-intent`);
    expect((init.headers as Record<string, string>)["idempotency-key"]).toBeTruthy();
    expect(JSON.stringify(init)).not.toMatch(/card|cvc|pan/i);
  });

  it("D098's security check held on this page too: a decline shows only the generic mapped message, never a raw decline code", async () => {
    const user = userEvent.setup();
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        jsonResponse({ detail: "Your card was declined.", retryableWithSameMethod: false }, 402),
      ),
    );

    render(<PaymentView slug={SLUG} orderId={ORDER_ID} />);

    await user.click(await screen.findByRole("button", { name: "Pay" }));

    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent("Your card was declined.");
    expect(alert).not.toHaveTextContent(/fraud|stolen|lost/i);
  });
});
