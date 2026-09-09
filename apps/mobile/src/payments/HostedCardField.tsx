import { useEffect, useState } from "react";
import { StyleSheet, Text, View } from "react-native";

export interface HostedCardFieldProps {
  onReady: () => void;
}

/**
 * `docs/cards/D146.md` — stands in for the Stripe React Native SDK's
 * `<CardField>` (`@stripe/stripe-react-native`), a native view that
 * collects card data entirely inside Stripe's own SDK and never routes it
 * through this app's JS/RN layer. This repo has no live Stripe mobile SDK
 * dependency yet — same "native/simulated now, real provider later"
 * posture web's `../../apps/web/src/app/m/[slug]/checkout/HostedCardField.tsx`
 * (D130) already established for the browser side. This is the only place
 * a card number, expiry, or CVC could ever be entered on this screen, and
 * it is never our own `TextInput` — `./cardFieldScanner.ts`'s repo-wide scan
 * (`pageCardFieldGuard.test.ts`) is this card's "no card data touches our
 * code on mobile either" security check, and it runs against this exact
 * file on every `pnpm test`.
 */
export function HostedCardField({ onReady }: HostedCardFieldProps) {
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
    onReady();
  }, [onReady]);

  return (
    <View testID="hosted-card-field" style={styles.container}>
      <Text>{mounted ? "Card details (hosted by payment provider)" : "Loading payment form…"}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { borderWidth: 1, borderColor: "#ccc", borderRadius: 6, padding: 16, alignItems: "center" },
});
