"use client";

import { useEffect, useState } from "react";

const API_BASE_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:3001";

type MerchantRole = "OWNER" | "ADMIN" | "STAFF" | "READ_ONLY";

interface TeamMember {
  merchantId: string;
  userId: string;
  role: MerchantRole;
  createdAt: string;
}

export interface TeamSettingsViewProps {
  merchantId: string;
}

const ROLES: MerchantRole[] = ["OWNER", "ADMIN", "STAFF", "READ_ONLY"];

/**
 * `docs/cards/D120.md` — Settings and team, Gate G6. Reads/writes
 * `apps/api/src/routes/team.ts`'s `GET`/`POST /team*` routes, the same
 * `X-Merchant-Id`-header pattern every other dashboard view in this app
 * uses. Role assignment is restricted server-side to `OWNER`
 * (`roles:assign`) — this view does not hide the control from a non-OWNER
 * viewer (there is no session/role context available client-side here yet,
 * the same gap every other Phase 6 view already carries), it relies on the
 * server rejecting the write and surfaces that rejection rather than
 * silently dropping it.
 *
 * This card's security check ("role changes audit-logged and notified to
 * owners") is enforced entirely server-side by `MerchantUserService`
 * (`@smb-os/db`) — this view's only contribution is that, on a successful
 * change, it re-fetches the team list from the server rather than
 * optimistically updating local state, so what's on screen is always what
 * was actually persisted (and therefore audit-logged).
 */
export function TeamSettingsView({ merchantId }: TeamSettingsViewProps) {
  const [members, setMembers] = useState<TeamMember[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  async function loadTeam(): Promise<void> {
    const response = await fetch(`${API_BASE_URL}/team`, {
      credentials: "include",
      headers: { "x-merchant-id": merchantId },
    });
    if (!response.ok) {
      setLoadError("Could not load team members.");
      return;
    }
    setLoadError(null);
    setMembers((await response.json()) as TeamMember[]);
  }

  useEffect(() => {
    let cancelled = false;
    async function load() {
      const response = await fetch(`${API_BASE_URL}/team`, {
        credentials: "include",
        headers: { "x-merchant-id": merchantId },
      });
      if (cancelled) return;
      if (!response.ok) {
        setLoadError("Could not load team members.");
        return;
      }
      setMembers((await response.json()) as TeamMember[]);
    }
    void load();
    return () => {
      cancelled = true;
    };
  }, [merchantId]);

  async function handleRoleChange(userId: string, role: MerchantRole) {
    setActionError(null);
    const response = await fetch(`${API_BASE_URL}/team/role-assignments`, {
      method: "POST",
      credentials: "include",
      headers: { "content-type": "application/json", "x-merchant-id": merchantId },
      body: JSON.stringify({ userId, role }),
    });
    if (!response.ok) {
      setActionError("Could not update that role.");
      return;
    }
    await loadTeam();
  }

  if (loadError) {
    return (
      <main>
        <h1>Team</h1>
        <p role="alert">{loadError}</p>
      </main>
    );
  }

  if (!members) {
    return (
      <main>
        <h1>Team</h1>
        <p>Loading…</p>
      </main>
    );
  }

  return (
    <main>
      <h1>Team</h1>
      {actionError && <p role="alert">{actionError}</p>}
      {members.length === 0 ? (
        <p>No team members yet.</p>
      ) : (
        <table>
          <thead>
            <tr>
              <th>User</th>
              <th>Role</th>
            </tr>
          </thead>
          <tbody>
            {members.map((member) => {
              const labelId = `role-${member.userId}`;
              return (
                <tr key={member.userId}>
                  <td>{member.userId}</td>
                  <td>
                    <label htmlFor={labelId}>{`Role for ${member.userId}`}</label>
                    <select
                      id={labelId}
                      aria-label={`Role for ${member.userId}`}
                      value={member.role}
                      onChange={(event) => void handleRoleChange(member.userId, event.target.value as MerchantRole)}
                    >
                      {ROLES.map((role) => (
                        <option key={role} value={role}>
                          {role}
                        </option>
                      ))}
                    </select>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
    </main>
  );
}
