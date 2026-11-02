import { useState } from "react";
import { ScrollView, StyleSheet, Text, View } from "react-native";
import { Button } from "../components/Button";
import { HostedCardField } from "./HostedCardField";
import { createPaymentIntent, type CreatePaymentIntentDeps } from "./fetchPaymentIntent";

export interface PaymentScreenProps {
  deps: CreatePaymentIntentDeps;
  slug: string;
  orderId: string;
  canGoBack: boolean;
  onGoBack: () => void;
  onPaid: () => void;
}

function formatMinor(amountMinor: number, currency: string): string {
  return `${(amountMinor / 100).toFixed(2)} ${currency}`;
}

/**
 * `docs/cards/D146.md` — mobile checkout's payment screen, mirroring
 * `apps/web/src/app/m/[slug]/checkout/PaymentView.tsx`'s (D130) orchestration
 * against the same server route. "Pay" stays disabled until `HostedCardField`
 * reports ready, so a submission can never race ahead of the mount point —
 * same posture as web. This card's acceptance criterion ("payment completes
 * on both platforms") holds because the underlying flow (fetch → server
 * route → `CheckoutPaymentService`) is entirely cross-platform HTTP, not
 * native code; the platform-specific part is exclusively inside the real
 * Stripe mobile SDK's `CardField`, which `HostedCardField` stands in for
 * here — see that file's doc comment for why this repo has no live
 * dependency on it yet.
 */
export function PaymentScreen({ deps, slug, orderId, canGoBack, onGoBack, onPaid }: PaymentScreenProps): React.JSX.Element {
  const [cardFieldReady, setCardFieldReady] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [success, setSuccess] = useState<{ amountMinor: number; currency: string } | null>(null);
  const [decline, setDecline] = useState<{ detail: string; retryableWithSameMethod: boolean } | null>(null);
  const [error, setError] = useState<string | null>(null);

  const backButton = canGoBack ? (
    <Button variant="secondary" onPress={onGoBack}>
      Back
    </Button>
  ) : null;

  async function handlePay() {
    setError(null);
    setDecline(null);
    setSubmitting(true);
    try {
      const result = await createPaymentIntent(deps, slug, orderId);
      if (result.ok) {
        setSuccess({ amountMinor: result.amountMinor, currency: result.currency });
        onPaid();
        return;
      }
      if (result.kind === "declined") {
        setDecline({ detail: result.detail, retryableWithSameMethod: result.retryableWithSameMethod });
        return;
      }
      setError(result.message);
    } finally {
      setSubmitting(false);
    }
  }

  if (success) {
    return (
      <View style={styles.container}>
        <Text style={styles.title}>Payment</Text>
        <Text accessibilityRole="alert">Payment completed — {formatMinor(success.amountMinor, success.currency)} charged.</Text>
        {backButton}
      </View>
    );
  }

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      <Text style={styles.title}>Payment</Text>
      {error && <Text accessibilityRole="alert">{error}</Text>}
      {decline && (
        <Text accessibilityRole="alert">
          {decline.detail}
          {decline.retryableWithSameMethod ? " You can try again with the same card." : " Please use a different card."}
        </Text>
      )}
      <HostedCardField onReady={() => setCardFieldReady(true)} />
      <Button variant="primary" disabled={!cardFieldReady || submitting} onPress={handlePay}>
        {submitting ? "Paying…" : "Pay"}
      </Button>
      {backButton}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, padding: 24, gap: 12 },
  content: { gap: 12, paddingBottom: 24 },
  title: { fontSize: 20, fontWeight: "600" },
});
