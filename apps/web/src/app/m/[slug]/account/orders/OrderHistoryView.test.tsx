// @vitest-environment jsdom
import { render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { OrderHistoryView } from "./OrderHistoryView";

const SLUG = "acme-rentals";

const HISTORY = {
  upcoming: [
    { id: "order-upcoming", status: "CONFIRMED", currency: "USD", totalMinor: 4500, placedAt: "2026-09-01T00:00:00.000Z", modes: ["SERVICE"] },
  ],
  past: [
    { id: "order-past", status: "FULFILLED", currency: "USD", totalMinor: 1200, placedAt: "2026-08-01T00:00:00.000Z", modes: ["PRODUCT"] },
  ],
};

function jsonResponse(body: unknown, status = 200): Response {
  return { ok: status < 300, status, json: () => Promise.resolve(body) } as Response;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("OrderHistoryView", () => {
  it("this card's deliverable: renders past and upcoming orders across modes", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse(HISTORY)));

    render(<OrderHistoryView slug={SLUG} />);

    expect(await screen.findByText(/45\.00 USD/)).toBeInTheDocument();
    expect(screen.getByText(/12\.00 USD/)).toBeInTheDocument();
    expect(screen.getByText(/upcoming/i)).toBeInTheDocument();
    expect(screen.getByText(/past/i)).toBeInTheDocument();
  });

  it("sends the session cookie with the request", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(HISTORY));
    vi.stubGlobal("fetch", fetchMock);

    render(<OrderHistoryView slug={SLUG} />);
    await screen.findByText(/45\.00 USD/);

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toContain(`/v1/m/${SLUG}/account/orders`);
    expect(init.credentials).toBe("include");
  });

  it("shows a sign-in message on 401 rather than an order list", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse({}, 401)));

    render(<OrderHistoryView slug={SLUG} />);

    expect(await screen.findByRole("alert")).toHaveTextContent(/sign in/i);
  });
});
