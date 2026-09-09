// @vitest-environment jsdom
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PaymentsView } from "./PaymentsView";

const MERCHANT_ID = "018f1e2a-0000-7000-8000-000000000001";

function mockFetchSequence(...responses: Array<{ ok: boolean; body: unknown }>) {
  const fetchMock = vi.fn();
  for (const { ok, body } of responses) {
    fetchMock.mockImplementationOnce(() =>
      Promise.resolve({ ok, json: () => Promise.resolve(body) } as Response),
    );
  }
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

describe("PaymentsView (D104 — Connect onboarding UI)", () => {
  let originalLocation: Location;

  beforeEach(() => {
    originalLocation = window.location;
    // @ts-expect-error jsdom doesn't implement navigation; this is the
    // standard trick to observe an assignment to window.location.href.
    delete window.location;
    window.location = { href: "" } as unknown as string & Location;
  });

  afterEach(() => {
    window.location = originalLocation as unknown as string & Location;
    vi.unstubAllGlobals();
  });

  it("shows a Connect payouts action before onboarding has started, scoped to the caller's merchant via X-Merchant-Id", async () => {
    const fetchMock = mockFetchSequence({ ok: true, body: { status: "NOT_STARTED" } });
    render(<PaymentsView merchantId={MERCHANT_ID} />);

    await screen.findByRole("button", { name: "Connect payouts" });
    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringContaining("/connect/status"),
      expect.objectContaining({ headers: { "x-merchant-id": MERCHANT_ID } }),
    );
  });

  it("clicking Connect payouts starts onboarding and redirects to the hosted flow's URL — never collects bank details itself", async () => {
    mockFetchSequence(
      { ok: true, body: { status: "NOT_STARTED" } },
      { ok: true, body: { onboardingUrl: "https://connect.simulated.stripe.example/onboarding/acct_1", expiresAt: "2026-09-08T00:05:00.000Z" } },
    );
    const user = userEvent.setup();
    render(<PaymentsView merchantId={MERCHANT_ID} />);

    const button = await screen.findByRole("button", { name: "Connect payouts" });
    await user.click(button);

    await waitFor(() => {
      expect(window.location.href).toBe("https://connect.simulated.stripe.example/onboarding/acct_1");
    });
  });

  it("shows an in-progress message and a Continue action while onboarding is started but not finished", async () => {
    mockFetchSequence({ ok: true, body: { status: "ONBOARDING", chargesEnabled: false, payoutsEnabled: false } });
    render(<PaymentsView merchantId={MERCHANT_ID} />);

    await screen.findByRole("button", { name: "Continue payouts setup" });
  });

  it("reports the payouts-enabled state once the hosted flow completes — this card's acceptance criterion", async () => {
    mockFetchSequence({ ok: true, body: { status: "ACTIVE", chargesEnabled: true, payoutsEnabled: true } });
    render(<PaymentsView merchantId={MERCHANT_ID} />);

    await screen.findByText(/Payouts are enabled/);
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
  });

  it("surfaces a load failure without crashing", async () => {
    mockFetchSequence({ ok: false, body: {} });
    render(<PaymentsView merchantId={MERCHANT_ID} />);

    await screen.findByRole("alert");
  });
});
