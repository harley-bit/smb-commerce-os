import { useEffect, useState } from "react";
import { ScrollView, StyleSheet, Text, View } from "react-native";
import type { PublicServiceDetail } from "@smb-os/contracts";
import { Button } from "../components/Button";
import { API_BASE_URL } from "../auth/apiConfig";
import { fetchServiceDetail } from "./fetchServiceDetail";
import { fetchServiceAvailability, type FreeInterval } from "./fetchServiceAvailability";
import { computeServiceAvailabilityWindow } from "./serviceAvailabilityWindow";

export interface ServiceDetailScreenProps {
  slug: string;
  listingSlug: string;
  canGoBack: boolean;
  onGoBack: () => void;
  onBook: (interval: FreeInterval) => void;
}

/** Deterministic, timezone-independent label — mirrors the web `ServiceDetailView.tsx`'s `formatSlotLabel`. */
function formatSlotLabel(interval: FreeInterval): string {
  const startLabel = interval.start.replace("T", " ").slice(0, 16);
  const endLabel = interval.end.slice(11, 16);
  return `${startLabel}–${endLabel} UTC`;
}

type State =
  | { kind: "loading" }
  | { kind: "not-found" }
  | { kind: "unsupported" }
  | { kind: "error" }
  | { kind: "loaded"; detail: PublicServiceDetail; free: FreeInterval[] };

/**
 * `docs/cards/D143.md` — service-mode listing detail and slot picker,
 * mirroring `apps/web/src/app/m/[slug]/l/[listingSlug]/ServiceDetailView.tsx`
 * and this app's own `./ProductDetailScreen.tsx` (D142) glue-screen
 * convention. Fetches the listing (`./fetchServiceDetail.ts`) then, for its
 * first assigned resource, the free/busy availability
 * (`./fetchServiceAvailability.ts`) over a fixed 14-day window
 * (`./serviceAvailabilityWindow.ts`) — month navigation is out of this
 * card's scope, same posture D125 added on top of D123 on web.
 *
 * This card's acceptance criterion, "Only free slots selectable": every
 * button rendered below comes verbatim from the `free` array — there is no
 * other selectable control on this screen and no client-side filtering step,
 * so a slot is selectable if and only if the server reported it free.
 *
 * This card's security check, "Free/busy only": `fetchServiceAvailability`
 * only ever reads `{ free: Interval[] }` off the wire — `start`/`end`
 * instants, never a reservation id or customer name — so this screen has no
 * busy-slot data to leak even if it wanted to.
 */
export function ServiceDetailScreen({ slug, listingSlug, canGoBack, onGoBack, onBook }: ServiceDetailScreenProps): React.JSX.Element {
  const [state, setState] = useState<State>({ kind: "loading" });
  const [selectedIndex, setSelectedIndex] = useState<number | null>(null);

  useEffect(() => {
    let cancelled = false;
    setState({ kind: "loading" });
    setSelectedIndex(null);

    void fetchServiceDetail({ baseUrl: API_BASE_URL, fetchFn: fetch }, slug, listingSlug).then(async (detailResult) => {
      if (cancelled) return;
      if (!detailResult.ok) {
        setState(
          detailResult.reason === "not-found"
            ? { kind: "not-found" }
            : detailResult.reason === "wrong-mode"
              ? { kind: "unsupported" }
              : { kind: "error" },
        );
        return;
      }

      const resourceId = detailResult.detail.resourceIds[0];
      if (!resourceId) {
        setState({ kind: "loaded", detail: detailResult.detail, free: [] });
        return;
      }

      const window = computeServiceAvailabilityWindow(new Date());
      const availabilityResult = await fetchServiceAvailability({ baseUrl: API_BASE_URL, fetchFn: fetch }, slug, resourceId, window.from, window.to);
      if (cancelled) return;
      setState({ kind: "loaded", detail: detailResult.detail, free: availabilityResult.ok ? availabilityResult.free : [] });
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
          Could not find that service.
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
          Something went wrong loading this service.
        </Text>
        {backButton}
      </View>
    );
  }

  const { detail, free } = state;
  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      <Text style={styles.title}>{detail.name}</Text>
      {detail.description ? <Text>{detail.description}</Text> : null}

      {free.length === 0 ? (
        <Text style={styles.empty}>No slots available right now.</Text>
      ) : (
        free.map((interval, index) => (
          <View key={`${interval.start}-${interval.end}`} style={styles.slotRow}>
            <Text style={styles.slotLabel}>{formatSlotLabel(interval)}</Text>
            <Button
              variant={selectedIndex === index ? "primary" : "secondary"}
              onPress={() => {
                setSelectedIndex(index);
                onBook(interval);
              }}
            >
              Book
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
  slotRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", gap: 12 },
  slotLabel: { flexShrink: 1 },
});
