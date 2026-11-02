import { useEffect, useState } from "react";
import { ScrollView, StyleSheet, Text, View } from "react-native";
import type { PublicListing, PublicMerchantProfile } from "@smb-os/contracts";
import { Button } from "../components/Button";
import { API_BASE_URL } from "../auth/apiConfig";
import { CATALOG_FILTERS, filterToMode, type CatalogFilter } from "./catalogFilter";
import { fetchCatalogPage } from "./fetchCatalogPage";
import { fetchMerchantHome } from "./fetchMerchantHome";

export interface HomeScreenProps {
  slug: string;
  onSelectListing: (listing: PublicListing) => void;
  onViewOrders: () => void;
}

/** One server round trip per "Load more" tap — small enough to page smoothly, large enough to rarely need one. */
const PAGE_SIZE = 20;

type ProfileState = { kind: "loading" } | { kind: "error"; message: string } | { kind: "loaded"; profile: PublicMerchantProfile };

type CatalogState =
  | { kind: "loading" }
  | { kind: "error"; message: string }
  | { kind: "loaded"; listings: PublicListing[]; cursor: string | null; loadingMore: boolean };

/**
 * `docs/cards/D141.md` — catalog browse with filters. Replaces D140's
 * unbounded "fetch every listing, group into three sections" load with a
 * mode filter (`CATALOG_FILTERS`) plus cursor-based "Load more" paging
 * (`./fetchCatalogPage.ts`) — this card's security check ("pagination
 * cursor-based, no offset leakage") is enforced one layer down, by the
 * server route this screen calls; this component only ever forwards the
 * cursor the server handed it in the previous page, never a
 * caller-computed position.
 */
export function HomeScreen({ slug, onSelectListing, onViewOrders }: HomeScreenProps): React.JSX.Element {
  const [profileState, setProfileState] = useState<ProfileState>({ kind: "loading" });
  const [filter, setFilter] = useState<CatalogFilter>("ALL");
  const [catalogState, setCatalogState] = useState<CatalogState>({ kind: "loading" });

  useEffect(() => {
    let cancelled = false;
    setProfileState({ kind: "loading" });
    void fetchMerchantHome({ baseUrl: API_BASE_URL, fetchFn: fetch }, slug).then((result) => {
      if (cancelled) return;
      setProfileState(result.ok ? { kind: "loaded", profile: result.profile } : { kind: "error", message: result.error });
    });
    return () => {
      cancelled = true;
    };
  }, [slug]);

  useEffect(() => {
    let cancelled = false;
    setCatalogState({ kind: "loading" });
    void fetchCatalogPage({ baseUrl: API_BASE_URL, fetchFn: fetch }, slug, { mode: filterToMode(filter), limit: PAGE_SIZE }).then(
      (result) => {
        if (cancelled) return;
        setCatalogState(
          result.ok
            ? { kind: "loaded", listings: result.listings, cursor: result.nextCursor, loadingMore: false }
            : { kind: "error", message: result.error },
        );
      },
    );
    return () => {
      cancelled = true;
    };
  }, [slug, filter]);

  function loadMore(): void {
    if (catalogState.kind !== "loaded" || catalogState.cursor === null || catalogState.loadingMore) return;
    const cursor = catalogState.cursor;
    setCatalogState({ ...catalogState, loadingMore: true });
    void fetchCatalogPage({ baseUrl: API_BASE_URL, fetchFn: fetch }, slug, {
      mode: filterToMode(filter),
      cursor,
      limit: PAGE_SIZE,
    }).then((result) => {
      setCatalogState((current) => {
        if (current.kind !== "loaded") return current;
        return result.ok
          ? { kind: "loaded", listings: [...current.listings, ...result.listings], cursor: result.nextCursor, loadingMore: false }
          : { kind: "error", message: result.error };
      });
    });
  }

  if (profileState.kind === "loading") {
    return (
      <View style={styles.container}>
        <Text>Loading…</Text>
      </View>
    );
  }

  if (profileState.kind === "error") {
    return (
      <View style={styles.container}>
        <Text accessibilityRole="alert" style={styles.error}>
          {profileState.message}
        </Text>
      </View>
    );
  }

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      <Text style={styles.title}>{profileState.profile.name}</Text>

      <View style={styles.filterRow}>
        {CATALOG_FILTERS.map(({ filter: candidate, label }) => (
          <Button key={candidate} variant={candidate === filter ? "primary" : "secondary"} onPress={() => setFilter(candidate)}>
            {label}
          </Button>
        ))}
      </View>

      {catalogState.kind === "loading" && <Text>Loading catalog…</Text>}

      {catalogState.kind === "error" && (
        <Text accessibilityRole="alert" style={styles.error}>
          {catalogState.message}
        </Text>
      )}

      {catalogState.kind === "loaded" && (
        <View style={styles.section}>
          {catalogState.listings.length === 0 ? (
            <Text style={styles.empty}>Nothing here yet.</Text>
          ) : (
            catalogState.listings.map((listing) => (
              <Button key={listing.id} variant="secondary" onPress={() => onSelectListing(listing)}>
                {listing.name}
              </Button>
            ))
          )}
          {catalogState.cursor !== null && (
            <Button variant="secondary" onPress={loadMore}>
              {catalogState.loadingMore ? "Loading…" : "Load more"}
            </Button>
          )}
        </View>
      )}

      <Button variant="secondary" onPress={onViewOrders}>
        My orders
      </Button>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, padding: 24 },
  content: { gap: 12, paddingBottom: 24 },
  title: { fontSize: 20, fontWeight: "600", marginBottom: 8 },
  filterRow: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  section: { gap: 8 },
  empty: { color: "#666" },
  error: { color: "#b00020" },
});
