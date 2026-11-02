import { useEffect, useState } from "react";
import { ScrollView, StyleSheet, Text, View } from "react-native";
import { Button } from "../components/Button";
import { selectCartLineStatuses, type CartState } from "./cartStore";

export interface CartScreenProps {
  cart: CartState;
  canGoBack: boolean;
  onGoBack: () => void;
  onRemoveLine: (lineId: string) => void;
  onCheckout: () => void;
}

function formatMinor(amountMinor: number, currency: string): string {
  return `${(amountMinor / 100).toFixed(2)} ${currency}`;
}

function formatCountdown(msRemaining: number): string {
  const totalSeconds = Math.ceil(msRemaining / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${seconds.toString().padStart(2, "0")}`;
}

/**
 * `docs/cards/D145.md` — cart with a per-line hold countdown. `now` ticks
 * once a second purely off `Date.now()` (via `setInterval`, no network
 * call anywhere in this component), so this screen behaves identically
 * whether the device is online or has been offline since the hold was
 * taken: `./cartStore.ts`'s `selectCartLineStatuses` is a pure function of
 * `cart` and `now`, and a hold that lapsed while offline shows exactly the
 * same "Hold expired" state the instant this screen renders as it would
 * have while the clock was ticking live — this card's acceptance criterion.
 *
 * "Checkout" is disabled while any line's hold has expired: the customer
 * has to remove or re-pick that line first, rather than silently checking
 * out against a lapsed hold.
 */
export function CartScreen({ cart, canGoBack, onGoBack, onRemoveLine, onCheckout }: CartScreenProps): React.JSX.Element {
  const [now, setNow] = useState(() => new Date());

  useEffect(() => {
    const interval = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(interval);
  }, []);

  const statuses = selectCartLineStatuses(cart, now);
  const hasExpiredHold = statuses.some((status) => status.countdown?.expired === true);

  const backButton = canGoBack ? (
    <Button variant="secondary" onPress={onGoBack}>
      Back
    </Button>
  ) : null;

  if (statuses.length === 0) {
    return (
      <View style={styles.container}>
        <Text style={styles.empty}>Your cart is empty.</Text>
        {backButton}
      </View>
    );
  }

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      <Text style={styles.title}>Cart</Text>

      {statuses.map(({ line, countdown }) => {
        const expired = countdown?.expired === true;
        return (
          <View key={line.id} style={[styles.lineRow, expired && styles.lineExpired]}>
            <View style={styles.lineInfo}>
              <Text style={styles.lineName}>{line.name}</Text>
              <Text style={styles.linePrice}>{formatMinor(line.unitPriceMinor * line.quantity, line.currency)}</Text>
              {countdown && !expired && <Text style={styles.countdown}>Hold expires in {formatCountdown(countdown.msRemaining)}</Text>}
              {expired && (
                <Text accessibilityRole="alert" style={styles.expiredNotice}>
                  Hold expired — remove this item and pick another slot.
                </Text>
              )}
            </View>
            <Button variant="secondary" onPress={() => onRemoveLine(line.id)}>
              Remove
            </Button>
          </View>
        );
      })}

      <Button variant="primary" disabled={hasExpiredHold} onPress={onCheckout}>
        Checkout
      </Button>

      {backButton}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, padding: 24, gap: 12 },
  content: { gap: 12, paddingBottom: 24 },
  title: { fontSize: 20, fontWeight: "600" },
  empty: { color: "#666" },
  lineRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", gap: 12 },
  lineExpired: { opacity: 0.6 },
  lineInfo: { gap: 2, flexShrink: 1 },
  lineName: { fontWeight: "600" },
  linePrice: { color: "#333" },
  countdown: { color: "#666" },
  expiredNotice: { color: "#b00020" },
});
