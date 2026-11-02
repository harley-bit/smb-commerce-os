import { useEffect, useState } from "react";
import { StyleSheet, Text, View } from "react-native";
import type { PublicRentalVariant, PublicVariant } from "@smb-os/contracts";
import { Button } from "../components/Button";
import { API_BASE_URL } from "../auth/apiConfig";
import { resolveListingMode } from "./resolveListingMode";
import { ProductDetailScreen } from "./ProductDetailScreen";
import { ServiceDetailScreen } from "./ServiceDetailScreen";
import { RentalDetailScreen } from "./RentalDetailScreen";
import type { FreeInterval } from "./fetchServiceAvailability";

export interface ListingDetailScreenProps {
  slug: string;
  listingSlug: string;
  canGoBack: boolean;
  onGoBack: () => void;
  onBuy: (variant: PublicVariant) => void;
  onBook: (interval: FreeInterval) => void;
  onReserveRental: (variant: PublicRentalVariant, startDate: string, endDate: string) => void;
}

type ModeState = { kind: "loading" } | { kind: "not-found" } | { kind: "unsupported" } | { kind: "resolved"; mode: "PRODUCT" | "SERVICE" | "RENTAL" };

/**
 * `docs/cards/D143.md` — `App.tsx`'s single `ListingDetail` route needs to
 * reach the right mode-specific screen (`./ProductDetailScreen.tsx`, D142;
 * `./ServiceDetailScreen.tsx`, this card; a future D144 rental screen)
 * without every mode's screen re-implementing its own mode-rejection UI.
 * Probes the listing's `mode` once via `./resolveListingMode.ts`, then
 * delegates to the matching screen, which still does its own complete
 * fetch-and-validate against `@smb-os/contracts` — this wrapper never
 * substitutes for that.
 */
export function ListingDetailScreen({
  slug,
  listingSlug,
  canGoBack,
  onGoBack,
  onBuy,
  onBook,
  onReserveRental,
}: ListingDetailScreenProps): React.JSX.Element {
  const [state, setState] = useState<ModeState>({ kind: "loading" });

  useEffect(() => {
    let cancelled = false;
    setState({ kind: "loading" });
    void resolveListingMode({ baseUrl: API_BASE_URL, fetchFn: fetch }, slug, listingSlug).then((result) => {
      if (cancelled) return;
      if (!result.ok) {
        setState(result.reason === "not-found" ? { kind: "not-found" } : { kind: "unsupported" });
        return;
      }
      setState({ kind: "resolved", mode: result.mode });
    });
    return () => {
      cancelled = true;
    };
  }, [slug, listingSlug]);

  const backButton = canGoBack ? (
    <Button variant="secondary" onPress={onGoBack}>
      Back
    </Button>
  ) : null;

  if (state.kind === "loading") {
    return (
      <View style={styles.container}>
        <Text>Loading…</Text>
      </View>
    );
  }

  if (state.kind === "not-found") {
    return (
      <View style={styles.container}>
        <Text accessibilityRole="alert" style={styles.error}>
          Could not find that listing.
        </Text>
        {backButton}
      </View>
    );
  }

  if (state.kind === "unsupported") {
    return (
      <View style={styles.container}>
        <Text style={styles.notice}>This listing isn&apos;t available in the app yet.</Text>
        {backButton}
      </View>
    );
  }

  if (state.mode === "SERVICE") {
    return <ServiceDetailScreen slug={slug} listingSlug={listingSlug} canGoBack={canGoBack} onGoBack={onGoBack} onBook={onBook} />;
  }

  if (state.mode === "RENTAL") {
    return (
      <RentalDetailScreen slug={slug} listingSlug={listingSlug} canGoBack={canGoBack} onGoBack={onGoBack} onReserve={onReserveRental} />
    );
  }

  return <ProductDetailScreen slug={slug} listingSlug={listingSlug} canGoBack={canGoBack} onGoBack={onGoBack} onBuy={onBuy} />;
}

const styles = StyleSheet.create({
  container: { flex: 1, padding: 24, gap: 12 },
  notice: { color: "#666" },
  error: { color: "#b00020" },
});
