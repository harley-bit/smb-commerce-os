import { useEffect, useState } from "react";
import { ScrollView, StyleSheet, Text, View } from "react-native";
import type { PublicProductDetail, PublicVariant } from "@smb-os/contracts";
import { Button } from "../components/Button";
import { API_BASE_URL } from "../auth/apiConfig";
import { fetchProductDetail } from "./fetchProductDetail";

export interface ProductDetailScreenProps {
  slug: string;
  listingSlug: string;
  canGoBack: boolean;
  onGoBack: () => void;
  onBuy: (variant: PublicVariant) => void;
}

const STOCK_STATUS_LABEL: Record<PublicVariant["stockStatus"], string> = {
  IN_STOCK: "In stock",
  OUT_OF_STOCK: "Out of stock",
};

function formatMinor(amountMinor: number, currency: string): string {
  return `${(amountMinor / 100).toFixed(2)} ${currency}`;
}

type State =
  | { kind: "loading" }
  | { kind: "not-found" }
  | { kind: "unsupported" }
  | { kind: "error" }
  | { kind: "loaded"; detail: PublicProductDetail };

/**
 * `docs/cards/D142.md` — product-mode listing detail, mirroring
 * `apps/web/src/app/m/[slug]/l/[listingSlug]/ProductDetailView.tsx`. Same
 * "buy" posture web's SERVICE/RENTAL "Reserve" buttons have per D124's log:
 * `CartService` still has no HTTP route, so tapping "Buy" can't add to a
 * real server-side cart yet — it pushes straight to the `Checkout` screen,
 * this card's acceptance criterion ("purchase path reaches checkout"),
 * rather than pretending a cart write happened. Every mount re-fetches via
 * `./fetchProductDetail.ts`, which never caches — this card's security
 * check.
 */
export function ProductDetailScreen({ slug, listingSlug, canGoBack, onGoBack, onBuy }: ProductDetailScreenProps): React.JSX.Element {
  const [state, setState] = useState<State>({ kind: "loading" });

  useEffect(() => {
    let cancelled = false;
    setState({ kind: "loading" });
    void fetchProductDetail({ baseUrl: API_BASE_URL, fetchFn: fetch }, slug, listingSlug).then((result) => {
      if (cancelled) return;
      if (!result.ok) {
        setState(
          result.reason === "not-found" ? { kind: "not-found" } : result.reason === "wrong-mode" ? { kind: "unsupported" } : { kind: "error" },
        );
        return;
      }
      setState({ kind: "loaded", detail: result.detail });
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
          Could not find that product.
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

  if (state.kind === "error") {
    return (
      <View style={styles.container}>
        <Text accessibilityRole="alert" style={styles.error}>
          Something went wrong loading this product.
        </Text>
        {backButton}
      </View>
    );
  }

  const { detail } = state;
  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      <Text style={styles.title}>{detail.name}</Text>
      {detail.description ? <Text>{detail.description}</Text> : null}

      {detail.variants.length === 0 ? (
        <Text style={styles.empty}>No options available.</Text>
      ) : (
        detail.variants.map((variant) => (
          <View key={variant.id} style={styles.variantRow}>
            <View style={styles.variantInfo}>
              <Text>{variant.name}</Text>
              <Text style={styles.price}>{formatMinor(variant.priceMinor, variant.currency)}</Text>
              <Text style={styles.stock}>{STOCK_STATUS_LABEL[variant.stockStatus]}</Text>
            </View>
            <Button variant="primary" disabled={variant.stockStatus === "OUT_OF_STOCK"} onPress={() => onBuy(variant)}>
              Buy
            </Button>
          </View>
        ))
      )}

      {backButton}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, padding: 24, gap: 12 },
  content: { gap: 12, paddingBottom: 24 },
  title: { fontSize: 20, fontWeight: "600" },
  empty: { color: "#666" },
  notice: { color: "#666" },
  error: { color: "#b00020" },
  variantRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", gap: 12 },
  variantInfo: { gap: 2 },
  price: { fontWeight: "600" },
  stock: { color: "#666" },
});
