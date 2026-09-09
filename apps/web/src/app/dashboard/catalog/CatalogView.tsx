"use client";

import { useEffect, useMemo, useState } from "react";
import type { Listing, ListingMode, ListingStatus } from "@smb-os/contracts";

const API_BASE_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:3001";

const MODE_OPTIONS: readonly ListingMode[] = ["PRODUCT", "SERVICE", "RENTAL"];
const STATUS_OPTIONS: readonly ListingStatus[] = ["DRAFT", "PUBLISHED", "ARCHIVED"];

export interface CatalogViewProps {
  merchantId: string;
}

/**
 * `docs/cards/D105.md` — Catalog list view. `GET /listings`
 * (`apps/api/src/routes/listings.ts`) is already tenant-scoped through
 * `ListingRepository`'s `TenantScopedRepository` base — this view sends
 * the caller's `X-Merchant-Id` the same way `PaymentsView` does and never
 * accepts a merchant id from anywhere else, so there is no client-side
 * path to another merchant's catalog (this card's security check).
 * Mode/status filtering happens entirely client-side over the one
 * tenant-scoped response, so a mixed-mode merchant always sees all three
 * modes together unless they deliberately narrow the view.
 */
export function CatalogView({ merchantId }: CatalogViewProps) {
  const [listings, setListings] = useState<Listing[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [modeFilter, setModeFilter] = useState<ListingMode | "ALL">("ALL");
  const [statusFilter, setStatusFilter] = useState<ListingStatus | "ALL">("ALL");

  useEffect(() => {
    let cancelled = false;
    async function loadListings() {
      const response = await fetch(`${API_BASE_URL}/listings`, {
        credentials: "include",
        headers: { "x-merchant-id": merchantId },
      });
      if (cancelled) return;
      if (!response.ok) {
        setError("Could not load catalog.");
        return;
      }
      setListings((await response.json()) as Listing[]);
    }
    void loadListings();
    return () => {
      cancelled = true;
    };
  }, [merchantId]);

  const filtered = useMemo(() => {
    if (!listings) return [];
    return listings.filter(
      (listing) =>
        (modeFilter === "ALL" || listing.mode === modeFilter) &&
        (statusFilter === "ALL" || listing.status === statusFilter),
    );
  }, [listings, modeFilter, statusFilter]);

  if (error) {
    return (
      <main>
        <h1>Catalog</h1>
        <p role="alert">{error}</p>
      </main>
    );
  }

  if (!listings) {
    return (
      <main>
        <h1>Catalog</h1>
        <p>Loading…</p>
      </main>
    );
  }

  return (
    <main>
      <h1>Catalog</h1>
      <a href={`/dashboard/catalog/new?merchantId=${merchantId}`}>New product</a>{" "}
      <a href={`/dashboard/catalog/new-service?merchantId=${merchantId}`}>New service</a>{" "}
      <a href={`/dashboard/catalog/new-rental?merchantId=${merchantId}`}>New rental</a>
      <div>
        <label htmlFor="catalog-mode-filter">Mode</label>
        <select
          id="catalog-mode-filter"
          value={modeFilter}
          onChange={(event) => setModeFilter(event.target.value as ListingMode | "ALL")}
        >
          <option value="ALL">All modes</option>
          {MODE_OPTIONS.map((mode) => (
            <option key={mode} value={mode}>
              {mode}
            </option>
          ))}
        </select>
        <label htmlFor="catalog-status-filter">Status</label>
        <select
          id="catalog-status-filter"
          value={statusFilter}
          onChange={(event) => setStatusFilter(event.target.value as ListingStatus | "ALL")}
        >
          <option value="ALL">All statuses</option>
          {STATUS_OPTIONS.map((status) => (
            <option key={status} value={status}>
              {status}
            </option>
          ))}
        </select>
      </div>
      {filtered.length === 0 ? (
        <p>No listings match the current filters.</p>
      ) : (
        <table>
          <thead>
            <tr>
              <th>Name</th>
              <th>Mode</th>
              <th>Status</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {filtered.map((listing) => (
              <tr key={listing.id}>
                <td>{listing.name}</td>
                <td>{listing.mode}</td>
                <td>{listing.status}</td>
                <td>
                  <a href={`/dashboard/catalog/${listing.id}/variants?merchantId=${merchantId}`}>Manage variants</a>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </main>
  );
}
