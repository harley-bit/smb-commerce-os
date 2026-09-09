import { useEffect, useState } from "react";
import { ScrollView, StyleSheet, Text, View } from "react-native";
import { Button } from "../components/Button";
import { API_BASE_URL } from "../auth/apiConfig";
import { ExpoSecureTokenStore } from "../auth/expoSecureTokenStore";
import { getAccessToken } from "../auth/authClient";
import { fetchOrderHistory, type OrderHistory, type OrderHistorySummary } from "./fetchOrderHistory";

const storage = new ExpoSecureTokenStore();

export interface AccountOrdersScreenProps {
  slug: string;
  canGoBack: boolean;
  onGoBack: () => void;
}

type State = { kind: "loading" } | { kind: "error"; message: string } | { kind: "loaded"; history: OrderHistory };

function formatMinor(amountMinor: number, currency: string): string {
  return `${(amountMinor / 100).toFixed(2)} ${currency}`;
}

function OrderList({ orders }: { orders: OrderHistorySummary[] }): React.JSX.Element {
  if (orders.length === 0) {
    return <Text style={styles.empty}>Nothing here yet.</Text>;
  }
  return (
    <View style={styles.section}>
      {orders.map((order) => (
        <Text key={order.id} style={styles.orderLine}>
          {formatMinor(order.totalMinor, order.currency)} — {order.status} — {order.modes.join(", ")}
        </Text>
      ))}
    </View>
  );
}

/**
 * `docs/cards/D147.md` — "Order history and upcoming". Thin RN glue over
 * `./fetchOrderHistory.ts`, same screen/fetch-helper split as every other
 * mobile screen since D140 (no test of its own — the logic worth testing
 * lives in the fetch helper, same boundary those cards' logs document).
 * Mirrors `apps/web/src/app/m/[slug]/account/orders/OrderHistoryView.tsx`'s
 * two-section (Upcoming/Past) layout.
 */
export function AccountOrdersScreen({ slug, canGoBack, onGoBack }: AccountOrdersScreenProps): React.JSX.Element {
  const [state, setState] = useState<State>({ kind: "loading" });

  useEffect(() => {
    let cancelled = false;
    setState({ kind: "loading" });
    void getAccessToken({ storage }).then((accessToken) =>
      fetchOrderHistory({ baseUrl: API_BASE_URL, fetchFn: fetch, accessToken }, slug).then((result) => {
        if (cancelled) return;
        if (result.ok) {
          setState({ kind: "loaded", history: result.history });
        } else if (result.reason === "unauthenticated") {
          setState({ kind: "error", message: "Please sign in to view your order history." });
        } else {
          setState({ kind: "error", message: "Could not load your order history." });
        }
      }),
    );
    return () => {
      cancelled = true;
    };
  }, [slug]);

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      <Text style={styles.title}>Your orders</Text>

      {state.kind === "loading" && <Text>Loading your orders…</Text>}

      {state.kind === "error" && (
        <Text accessibilityRole="alert" style={styles.error}>
          {state.message}
        </Text>
      )}

      {state.kind === "loaded" && (
        <>
          <Text style={styles.sectionTitle}>Upcoming</Text>
          <OrderList orders={state.history.upcoming} />
          <Text style={styles.sectionTitle}>Past</Text>
          <OrderList orders={state.history.past} />
        </>
      )}

      {canGoBack ? (
        <Button variant="secondary" onPress={onGoBack}>
          Back
        </Button>
      ) : null}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, padding: 24 },
  content: { gap: 12, paddingBottom: 24 },
  title: { fontSize: 20, fontWeight: "600", marginBottom: 8 },
  sectionTitle: { fontSize: 16, fontWeight: "600" },
  section: { gap: 4 },
  orderLine: { fontSize: 14 },
  empty: { color: "#666" },
  error: { color: "#b00020" },
});
