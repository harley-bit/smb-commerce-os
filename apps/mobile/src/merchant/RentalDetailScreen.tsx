import { useEffect, useState } from "react";
import { ScrollView, StyleSheet, Text, View } from "react-native";
import type { PublicRentalDetail, PublicRentalVariant } from "@smb-os/contracts";
import { Button } from "../components/Button";
import { TextField } from "../components/TextField";
import { API_BASE_URL } from "../auth/apiConfig";
import { fetchRentalDetail } from "./fetchRentalDetail";
import { fetchRentalAvailability } from "./fetchRentalAvailability";

export interface RentalDetailScreenProps {
  slug: string;
  listingSlug: string;
  canGoBack: boolean;
  onGoBack: () => void;
  onReserve: (variant: PublicRentalVariant, startDate: string, endDate: string) => void;
}

function formatMinor(amountMinor: number, currency: string): string {
  return `${(amountMinor / 100).toFixed(2)} ${currency}`;
}

type State =
  | { kind: "loading" }
  | { kind: "not-found" }
  | { kind: "unsupported" }
  | { kind: "error" }
  | { kind: "loaded"; detail: PublicRentalDetail };

/**
 * `docs/cards/D144.md` — rental-mode listing detail: date-range picker plus
 * deposit disclosure, mirroring
 * `apps/web/src/app/m/[slug]/l/[listingSlug]/RentalDetailView.tsx` and this
 * app's own `./ProductDetailScreen.tsx`/`./ServiceDetailScreen.tsx` glue
 * convention.
 *
 * This card's security check, "Disclosure parity with web": the deposit/rate
 * line renders unconditionally as soon as the listing loads — before either
 * date field exists in any interactive state — the same unconditional
 * placement (above and independent of the date inputs) the web view uses.
 * Only ever reads `variants[0]`, the same single-variant deviation
 * `ServiceDetailScreen` made for `resourceIds[0]`.
 *
 * This card's acceptance criterion, "Deposit terms shown before checkout":
 * the deposit/rate text renders in the `loaded` state regardless of whether
 * any date has been picked yet, so a visitor sees it before a single date is
 * entered, let alone before "Reserve" becomes selectable.
 */
export function RentalDetailScreen({ slug, listingSlug, canGoBack, onGoBack, onReserve }: RentalDetailScreenProps): React.JSX.Element {
  const [state, setState] = useState<State>({ kind: "loading" });
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");
  const [available, setAvailable] = useState<boolean | null>(null);
  const [rangeError, setRangeError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setState({ kind: "loading" });
    setStartDate("");
    setEndDate("");
    setAvailable(null);
    setRangeError(null);

    void fetchRentalDetail({ baseUrl: API_BASE_URL, fetchFn: fetch }, slug, listingSlug).then((result) => {
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

  const variant = state.kind === "loaded" ? state.detail.variants[0] : undefined;

  useEffect(() => {
    setAvailable(null);
    if (!variant || !startDate || !endDate) {
      setRangeError(null);
      return;
    }
    const from = `${startDate}T00:00:00.000Z`;
    const to = `${endDate}T00:00:00.000Z`;
    if (to <= from) {
      setRangeError("The end date must be after the start date.");
      return;
    }
    setRangeError(null);
    let cancelled = false;
    void fetchRentalAvailability({ baseUrl: API_BASE_URL, fetchFn: fetch }, slug, listingSlug, variant.id, from, to).then((result) => {
      if (cancelled) return;
      setAvailable(result.ok ? result.available : null);
    });
    return () => {
      cancelled = true;
    };
  }, [slug, listingSlug, variant, startDate, endDate]);

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
          Could not find that rental.
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
          Something went wrong loading this rental.
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

      {!variant ? (
        <Text style={styles.empty}>No rental options available.</Text>
      ) : (
        <>
          <Text style={styles.deposit}>
            {formatMinor(variant.priceMinor, variant.currency)} per {variant.ratePeriod?.toLowerCase() ?? "period"} —{" "}
            {variant.depositMinor === null
              ? "no deposit required"
              : `refundable deposit of ${formatMinor(variant.depositMinor, variant.currency)}`}
          </Text>

          <TextField label="Start date" placeholder="YYYY-MM-DD" value={startDate} onChangeText={setStartDate} />
          <TextField label="End date" placeholder="YYYY-MM-DD" value={endDate} onChangeText={setEndDate} error={rangeError ?? undefined} />

          {available === false && <Text style={styles.notice}>That date range is not available. Please choose another.</Text>}
          {available === true && (
            <Button variant="primary" onPress={() => onReserve(variant, startDate, endDate)}>
              {`Reserve ${startDate} – ${endDate}`}
            </Button>
          )}
        </>
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
  deposit: { fontWeight: "600" },
});
