// @vitest-environment jsdom
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { TeamSettingsView } from "./TeamSettingsView";

const MERCHANT_ID = "018f1e2a-0000-7000-8000-000000000003";

interface MemberRow {
  merchantId: string;
  userId: string;
  role: "OWNER" | "ADMIN" | "STAFF" | "READ_ONLY";
  createdAt: string;
}

function jsonResponse(ok: boolean, body: unknown, status = 200): Response {
  return { ok, status, json: () => Promise.resolve(body) } as Response;
}

function mockTeam(members: MemberRow[], opts: { assignStatus?: number } = {}) {
  const fetchMock = vi.fn().mockImplementation((url: string, init?: RequestInit) => {
    if (typeof url === "string" && url.endsWith("/team") && (!init || init.method === undefined)) {
      return Promise.resolve(jsonResponse(true, members));
    }
    if (typeof url === "string" && url.endsWith("/team/role-assignments")) {
      const status = opts.assignStatus ?? 204;
      return Promise.resolve(jsonResponse(status < 300, {}, status));
    }
    return Promise.reject(new Error(`Unexpected fetch: ${url}`));
  });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("TeamSettingsView", () => {
  it("renders every team member with their current role", async () => {
    mockTeam([
      { merchantId: MERCHANT_ID, userId: "u-owner", role: "OWNER", createdAt: "2026-09-01T00:00:00.000Z" },
      { merchantId: MERCHANT_ID, userId: "u-staff", role: "STAFF", createdAt: "2026-09-01T00:00:00.000Z" },
    ]);
    render(<TeamSettingsView merchantId={MERCHANT_ID} />);

    expect(await screen.findByText("u-owner")).toBeInTheDocument();
    expect(screen.getByText("u-staff")).toBeInTheDocument();
  });

  it("changes a member's role and re-renders the persisted result from the server", async () => {
    const fetchMock = mockTeam([
      { merchantId: MERCHANT_ID, userId: "u-owner", role: "OWNER", createdAt: "2026-09-01T00:00:00.000Z" },
      { merchantId: MERCHANT_ID, userId: "u-staff", role: "STAFF", createdAt: "2026-09-01T00:00:00.000Z" },
    ]);
    render(<TeamSettingsView merchantId={MERCHANT_ID} />);
    await screen.findByText("u-staff");

    const select = screen.getByLabelText("Role for u-staff");
    fireEvent.change(select, { target: { value: "ADMIN" } });

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(
        expect.stringContaining("/team/role-assignments"),
        expect.objectContaining({ method: "POST" }),
      );
    });
  });

  it("surfaces a forbidden response instead of silently ignoring it", async () => {
    mockTeam(
      [{ merchantId: MERCHANT_ID, userId: "u-staff", role: "STAFF", createdAt: "2026-09-01T00:00:00.000Z" }],
      { assignStatus: 403 },
    );
    render(<TeamSettingsView merchantId={MERCHANT_ID} />);
    await screen.findByText("u-staff");

    const select = screen.getByLabelText("Role for u-staff");
    fireEvent.change(select, { target: { value: "ADMIN" } });

    expect(await screen.findByRole("alert")).toHaveTextContent("Could not update that role.");
  });

  it("shows an empty state when there are no team members", async () => {
    mockTeam([]);
    render(<TeamSettingsView merchantId={MERCHANT_ID} />);
    expect(await screen.findByText("No team members yet.")).toBeInTheDocument();
  });

  it("shows an error when the initial load fails", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(false, {}, 500));
    vi.stubGlobal("fetch", fetchMock);
    render(<TeamSettingsView merchantId={MERCHANT_ID} />);

    expect(await screen.findByRole("alert")).toHaveTextContent("Could not load team members.");
  });
});
