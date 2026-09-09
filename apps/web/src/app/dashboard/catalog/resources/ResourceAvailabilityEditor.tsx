"use client";

import { useEffect, useMemo, useState } from "react";
import { z } from "zod";
import type { AvailabilityRule, Location, Resource } from "@smb-os/contracts";
import { Button, TextField } from "../../../../components";
import { formatIntervalInZone, type FreeInterval } from "./formatIntervalInZone";

const API_BASE_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:3001";

const WEEKDAY_NAMES = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"] as const;
const AVAILABILITY_WINDOW_DAYS = 14;

/**
 * Same posture as `ProductEditor.tsx`'s `listingDraftSchema` — a structural
 * mirror of `@smb-os/contracts`'s `createAvailabilityRuleInputSchema`, not
 * an import of it, so this "use client" bundle never pulls in
 * `@smb-os/domain`'s `node:crypto` dependency (`docs/logs/D106.md`). The
 * real authority is still `ResourceService.createAvailabilityRule`'s
 * server-side validation.
 */
const ruleDraftSchema = z.object({
  weekday: z.number().int().min(0).max(6),
  startTime: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, "expected HH:MM"),
  endTime: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, "expected HH:MM"),
});

export interface ResourceAvailabilityEditorProps {
  merchantId: string;
}

/**
 * `docs/cards/D112.md` — Resources and availability editor. Deliverable:
 * "Weekly rules per resource" — `ResourceService.createAvailabilityRule`/
 * `listAvailabilityRules` (D058) already existed with no dashboard UI; this
 * component is that editor. Acceptance criterion: "Availability renders
 * correctly in merchant timezone" — the "Upcoming availability" list below
 * the rule form is fetched from the new authenticated
 * `GET /resources/:id/availability` route and converted from raw UTC
 * instants to the selected resource's own *location* timezone via
 * `formatIntervalInZone`, never the browser's local zone. Security check:
 * "Timezone handling verified across DST" — answered by
 * `formatIntervalInZone.test.ts`, which proves the same weekly rule renders
 * an identical local wall-clock window on both sides of a real US DST
 * transition, and by `apps/api/test/resources.test.ts`'s equivalent proof
 * one layer down, at the route/domain boundary
 * (`packages/domain/src/utils/availabilityRule.ts`'s `expandAvailabilityRule`,
 * unchanged by this card).
 */
export function ResourceAvailabilityEditor({ merchantId }: ResourceAvailabilityEditorProps) {
  const [locations, setLocations] = useState<Location[] | null>(null);
  const [resources, setResources] = useState<Resource[] | null>(null);
  const [selectedResourceId, setSelectedResourceId] = useState("");
  const [rules, setRules] = useState<AvailabilityRule[]>([]);
  const [free, setFree] = useState<FreeInterval[]>([]);
  const [weekday, setWeekday] = useState("1");
  const [startTime, setStartTime] = useState("");
  const [endTime, setEndTime] = useState("");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      const locationsResponse = await fetch(`${API_BASE_URL}/locations`, {
        credentials: "include",
        headers: { "x-merchant-id": merchantId },
      });
      const loadedLocations = locationsResponse.ok ? ((await locationsResponse.json()) as Location[]) : [];
      if (cancelled) return;
      setLocations(loadedLocations);

      const resourcesResponse = await fetch(`${API_BASE_URL}/resources`, {
        credentials: "include",
        headers: { "x-merchant-id": merchantId },
      });
      const loadedResources = resourcesResponse.ok ? ((await resourcesResponse.json()) as Resource[]) : [];
      if (cancelled) return;
      setResources(loadedResources);
      if (loadedResources.length > 0) {
        setSelectedResourceId(loadedResources[0]!.id);
      }
    }
    void load();
    return () => {
      cancelled = true;
    };
  }, [merchantId]);

  const selectedResource = useMemo(
    () => resources?.find((resource) => resource.id === selectedResourceId) ?? null,
    [resources, selectedResourceId],
  );
  const selectedLocation = useMemo(
    () => locations?.find((location) => location.id === selectedResource?.locationId) ?? null,
    [locations, selectedResource],
  );

  async function loadRulesAndAvailability(resourceId: string) {
    const rulesResponse = await fetch(`${API_BASE_URL}/resources/${resourceId}/availability-rules`, {
      credentials: "include",
      headers: { "x-merchant-id": merchantId },
    });
    setRules(rulesResponse.ok ? ((await rulesResponse.json()) as AvailabilityRule[]) : []);

    const from = new Date().toISOString();
    const to = new Date(Date.now() + AVAILABILITY_WINDOW_DAYS * 24 * 60 * 60 * 1000).toISOString();
    const availabilityResponse = await fetch(
      `${API_BASE_URL}/resources/${resourceId}/availability?from=${from}&to=${to}`,
      { credentials: "include", headers: { "x-merchant-id": merchantId } },
    );
    if (availabilityResponse.ok) {
      const body = (await availabilityResponse.json()) as { free: FreeInterval[] };
      setFree(body.free);
    } else {
      setFree([]);
    }
  }

  useEffect(() => {
    if (!selectedResourceId) return;
    let cancelled = false;
    async function run() {
      await loadRulesAndAvailability(selectedResourceId);
      if (cancelled) return;
    }
    void run();
    return () => {
      cancelled = true;
    };
  }, [selectedResourceId]);

  async function handleAddRule() {
    setError(null);
    const parsed = ruleDraftSchema.safeParse({ weekday: Number(weekday), startTime, endTime });
    if (!parsed.success) {
      setError(parsed.error.issues[0]?.message ?? "Invalid rule.");
      return;
    }
    if (!selectedResourceId) {
      setError("Choose a resource first.");
      return;
    }
    const response = await fetch(`${API_BASE_URL}/resources/${selectedResourceId}/availability-rules`, {
      method: "POST",
      credentials: "include",
      headers: { "content-type": "application/json", "x-merchant-id": merchantId },
      body: JSON.stringify(parsed.data),
    });
    if (!response.ok) {
      setError("Could not save the rule.");
      return;
    }
    setStartTime("");
    setEndTime("");
    await loadRulesAndAvailability(selectedResourceId);
  }

  if (!resources) {
    return (
      <main>
        <h1>Resources and availability</h1>
        <p>Loading…</p>
      </main>
    );
  }

  return (
    <main>
      <h1>Resources and availability</h1>
      {resources.length === 0 ? (
        <p>No resources yet.</p>
      ) : (
        <>
          <label htmlFor="resource-select">Resource</label>
          <select
            id="resource-select"
            value={selectedResourceId}
            onChange={(event) => setSelectedResourceId(event.target.value)}
          >
            {resources.map((resource) => (
              <option key={resource.id} value={resource.id}>
                {resource.name}
              </option>
            ))}
          </select>

          {selectedLocation && <p>Timezone: {selectedLocation.timezone}</p>}

          {error && <p role="alert">{error}</p>}

          <section>
            <h2>Weekly rules</h2>
            {rules.length === 0 ? (
              <p>No weekly rules yet.</p>
            ) : (
              <table>
                <thead>
                  <tr>
                    <th>Weekday</th>
                    <th>Start</th>
                    <th>End</th>
                  </tr>
                </thead>
                <tbody>
                  {rules.map((rule) => (
                    <tr key={rule.id}>
                      <td>{WEEKDAY_NAMES[rule.weekday]}</td>
                      <td>{rule.startTime}</td>
                      <td>{rule.endTime}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}

            <label htmlFor="rule-weekday">Weekday</label>
            <select id="rule-weekday" value={weekday} onChange={(event) => setWeekday(event.target.value)}>
              {WEEKDAY_NAMES.map((name, index) => (
                <option key={name} value={index}>
                  {name}
                </option>
              ))}
            </select>
            <TextField
              label="Start time (HH:MM)"
              value={startTime}
              onChange={(event) => setStartTime(event.target.value)}
            />
            <TextField
              label="End time (HH:MM)"
              value={endTime}
              onChange={(event) => setEndTime(event.target.value)}
            />
            <Button onClick={() => void handleAddRule()}>Add weekly rule</Button>
          </section>

          <section>
            <h2>Upcoming availability {selectedLocation && `(${selectedLocation.timezone})`}</h2>
            {free.length === 0 ? (
              <p>No upcoming availability.</p>
            ) : (
              <ul>
                {free.map((interval) => {
                  const formatted = selectedLocation
                    ? formatIntervalInZone(interval, selectedLocation.timezone)
                    : null;
                  return (
                    <li key={`${interval.start}-${interval.end}`}>
                      {formatted ? `${formatted.date}: ${formatted.startTime} – ${formatted.endTime}` : interval.start}
                    </li>
                  );
                })}
              </ul>
            )}
          </section>
        </>
      )}
    </main>
  );
}
