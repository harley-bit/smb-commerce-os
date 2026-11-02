// @vitest-environment jsdom
import { fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { DamageClaimView } from "./DamageClaimView";

const MERCHANT_ID = "018f1e2a-0000-7000-8000-000000000002";
const ORDER_LINE_ID = "018f1e2a-0000-7000-8000-000000000031";
const CLAIM_ID = "018f1e2a-0000-7000-8000-000000000034";

function jsonResponse(ok: boolean, body: unknown, status = 200): Response {
  return { ok, status, json: () => Promise.resolve(body) } as Response;
}

const DEPOSIT = { id: "dep-1", amountMinor: 20_000, currency: "USD", state: "AUTHORIZED", capturedMinor: null };

function mockRoutes(overrides: {
  claims?: unknown[];
  deposit?: unknown;
  onFile?: () => void;
  onNotify?: () => void;
  onCapture?: (body: { amountMinor: number }) => Response | undefined;
  onWaive?: () => void;
}) {
  let claims = overrides.claims ?? [];
  const deposit = overrides.deposit === undefined ? DEPOSIT : overrides.deposit;

  const fetchMock = vi.fn().mockImplementation((url: string, init?: RequestInit) => {
    if (typeof url === "string" && url.endsWith("/damage-claims") && (!init || init.method === undefined)) {
      return Promise.resolve(jsonResponse(true, claims));
    }
    if (typeof url === "string" && url.endsWith("/deposit-authorization")) {
      return Promise.resolve(jsonResponse(true, deposit));
    }
    if (typeof url === "string" && url.endsWith("/damage-claims") && init?.method === "POST") {
      overrides.onFile?.();
      claims = [{ id: CLAIM_ID, amountMinor: 7_500, state: "FILED", filedAt: "2026-09-08T00:00:00.000Z", resolvedAt: null, resolutionNote: null }];
      return Promise.resolve(jsonResponse(true, { id: CLAIM_ID }, 201));
    }
    if (typeof url === "string" && url.endsWith("/notify") && init?.method === "POST") {
      overrides.onNotify?.();
      claims = claims.map((claim) => ({ ...(claim as Record<string, unknown>), state: "CUSTOMER_NOTIFIED" }));
      return Promise.resolve(jsonResponse(true, { state: "CUSTOMER_NOTIFIED" }));
    }
    if (typeof url === "string" && url.endsWith("/capture") && init?.method === "POST") {
      const body = JSON.parse(init!.body as string) as { amountMinor: number };
      const response = overrides.onCapture?.(body);
      if (response) return Promise.resolve(response);
      claims = claims.map((claim) => ({ ...(claim as Record<string, unknown>), state: "RESOLVED_CAPTURED" }));
      return Promise.resolve(jsonResponse(true, { state: "PARTIALLY_CAPTURED", capturedMinor: body.amountMinor }));
    }
    if (typeof url === "string" && url.endsWith("/waive") && init?.method === "POST") {
      overrides.onWaive?.();
      claims = claims.map((claim) => ({ ...(claim as Record<string, unknown>), state: "RESOLVED_WAIVED" }));
      return Promise.resolve(jsonResponse(true, { state: "RESOLVED_WAIVED" }));
    }
    return Promise.reject(new Error(`Unexpected fetch: ${url}`));
  });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

describe("DamageClaimView (D118 — Damage claim UI)", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("loads the deposit hold's authorized amount and the claim list", async () => {
    mockRoutes({ claims: [] });

    render(<DamageClaimView merchantId={MERCHANT_ID} orderLineId={ORDER_LINE_ID} />);

    await screen.findByText(/Authorized amount: 200.00 USD/);
    expect(screen.getByText("No damage claims filed.")).toBeInTheDocument();
  });

  it("files a claim, notifies the customer, then reveals capture/waive — the full review flow", async () => {
    mockRoutes({ claims: [] });
    render(<DamageClaimView merchantId={MERCHANT_ID} orderLineId={ORDER_LINE_ID} />);

    await screen.findByRole("button", { name: "File claim" });
    fireEvent.change(screen.getByLabelText("Amount (minor units)"), { target: { value: "7500" } });
    fireEvent.click(screen.getByRole("button", { name: "File claim" }));

    await screen.findByRole("button", { name: "Notify customer" });
    fireEvent.click(screen.getByRole("button", { name: "Notify customer" }));

    await screen.findByRole("button", { name: "Capture deposit" });
    expect(screen.getByRole("button", { name: "Waive claim" })).toBeInTheDocument();
  });

  it("bounds the capture input's max to the authorized deposit amount — this card's acceptance criterion", async () => {
    mockRoutes({
      claims: [{ id: CLAIM_ID, amountMinor: 7_500, state: "CUSTOMER_NOTIFIED", filedAt: "2026-09-08T00:00:00.000Z", resolvedAt: null, resolutionNote: null }],
    });

    render(<DamageClaimView merchantId={MERCHANT_ID} orderLineId={ORDER_LINE_ID} />);

    const input = await screen.findByLabelText("Capture amount (minor units)");
    expect(input).toHaveAttribute("max", "20000");
  });

  it("rejects a capture attempt above the authorized amount client-side, without calling the server", async () => {
    const onCapture = vi.fn();
    const fetchMock = mockRoutes({
      claims: [{ id: CLAIM_ID, amountMinor: 7_500, state: "CUSTOMER_NOTIFIED", filedAt: "2026-09-08T00:00:00.000Z", resolvedAt: null, resolutionNote: null }],
      onCapture: () => {
        onCapture();
        return undefined;
      },
    });

    render(<DamageClaimView merchantId={MERCHANT_ID} orderLineId={ORDER_LINE_ID} />);

    const input = await screen.findByLabelText("Capture amount (minor units)");
    fireEvent.change(input, { target: { value: "20001" } });
    fireEvent.click(screen.getByLabelText("I confirm this capture amount is correct."));

    // The `max` attribute (bounded to the authorized amount) makes the
    // input fail native HTML5 constraint validation before the form can
    // ever submit — the browser itself blocks the request, not just this
    // component's own JS-level check.
    expect((input as HTMLInputElement).checkValidity()).toBe(false);

    fireEvent.click(screen.getByRole("button", { name: "Capture deposit" }));
    await Promise.resolve();

    expect(onCapture).not.toHaveBeenCalled();
    expect(fetchMock.mock.calls.some(([url]) => typeof url === "string" && url.endsWith("/capture"))).toBe(false);
    expect(screen.queryByText("Deposit captured.")).not.toBeInTheDocument();
  });

  it("requires the confirmation checkbox before the capture button is enabled — this card's security check", async () => {
    mockRoutes({
      claims: [{ id: CLAIM_ID, amountMinor: 7_500, state: "CUSTOMER_NOTIFIED", filedAt: "2026-09-08T00:00:00.000Z", resolvedAt: null, resolutionNote: null }],
    });

    render(<DamageClaimView merchantId={MERCHANT_ID} orderLineId={ORDER_LINE_ID} />);

    await screen.findByLabelText("Capture amount (minor units)");
    expect(screen.getByRole("button", { name: "Capture deposit" })).toBeDisabled();

    fireEvent.click(screen.getByLabelText("I confirm this capture amount is correct."));
    expect(screen.getByRole("button", { name: "Capture deposit" })).toBeEnabled();
  });

  it("captures within the bound and shows the result — this card's acceptance criterion", async () => {
    mockRoutes({
      claims: [{ id: CLAIM_ID, amountMinor: 7_500, state: "CUSTOMER_NOTIFIED", filedAt: "2026-09-08T00:00:00.000Z", resolvedAt: null, resolutionNote: null }],
    });

    render(<DamageClaimView merchantId={MERCHANT_ID} orderLineId={ORDER_LINE_ID} />);

    fireEvent.change(await screen.findByLabelText("Capture amount (minor units)"), { target: { value: "7500" } });
    fireEvent.click(screen.getByLabelText("I confirm this capture amount is correct."));
    fireEvent.click(screen.getByRole("button", { name: "Capture deposit" }));

    await screen.findByText("Deposit captured.");
  });

  it("waives a claim without capturing anything", async () => {
    mockRoutes({
      claims: [{ id: CLAIM_ID, amountMinor: 7_500, state: "CUSTOMER_NOTIFIED", filedAt: "2026-09-08T00:00:00.000Z", resolvedAt: null, resolutionNote: null }],
    });

    render(<DamageClaimView merchantId={MERCHANT_ID} orderLineId={ORDER_LINE_ID} />);

    await screen.findByRole("button", { name: "Waive claim" });
    fireEvent.click(screen.getByRole("button", { name: "Waive claim" }));

    await screen.findByText("Claim waived — no deposit was captured.");
  });

  it("shows a load-failure state", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse(false, {}, 500)));

    render(<DamageClaimView merchantId={MERCHANT_ID} orderLineId={ORDER_LINE_ID} />);

    await screen.findByText("Could not load this rental's damage-claim history.");
  });
});
