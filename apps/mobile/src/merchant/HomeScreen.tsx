import { useEffect, useState } from "react";
import { ScrollView, StyleSheet, Text, View } from "react-native";
import type { PublicListing, PublicMerchantProfile } from "@smb-os/contracts";
import { Button } from "../components/Button";
import { API_BASE_URL } from "../auth/apiConfig";
import { fetchMerchantHome } from "./fetchMerchantHome";
import { groupListingsByMode } from "./merchantCatalog";

export interface HomeScreenProps {
  slug: string;
  onSelectListing: (listing: PublicListing) => void;
  onViewOrders: () => void;
}

type State =
  | { kind: "loading" }
  | { kind: "error"; message: string }
  | { kind: "loaded"; profile: PublicMerchantProfile; listings: PublicListing[] };

/**
 * `docs/cards/D140.md` — merchant discovery and page, the mobile `Home`
 * screen `App.tsx`/`PlaceholderScreen.tsx` (`docs/cards/D139.md`) named but
 * did not yet build. Same unauthenticated read as
 * `apps/web/src/app/m/[slug]/MerchantPageView.tsx`, factored through
 * `./fetchMerchantHome.ts` (network + contract validation, unit-tested) and
 * `./merchantCatalog.ts` (mode grouping, unit-tested) so this component is
 * thin glue with no test of its own — same boundary `SignInScreen.tsx`
 * documents for React Native rendering.
 */
export function HomeScreen({ slug, onSelectListing, onViewOrders }: HomeScreenProps): React.JSX.Element {
  const [state, setState] = useState<State>({ kind: "loading" });

  useEffect(() => {
    let cancelled = false;
    setState({ kind: "loading" });
    void fetchMerchantHome({ baseUrl: API_BASE_URL, fetchFn: fetch }, slug).then((result) => {
      if (cancelled) return;
      setState(
        result.ok
          ? { kind: "loaded", profile: result.profile, listings: result.listings }
          : { kind: "error", message: result.error },
      );
    });
    return () => {
      cancelled = true;
    };
  }, [slug]);

  if (state.kind === "loading") {
    return (
      <View style={styles.container}>
        <Text>Loading…</Text>
      </View>
    );
  }

  if (state.kind === "error") {
    return (
      <View style={styles.container}>
        <Text accessibilityRole="alert" style={styles.error}>
          {state.message}
        </Text>
      </View>
    );
  }

  const sections = groupListingsByMode(state.listings);

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      <Text style={styles.title}>{state.profile.name}</Text>
      {sections.map((section) => (
        <View key={section.mode} style={styles.section}>
          <Text style={styles.sectionHeading}>{section.heading}</Text>
          {section.listings.length === 0 ? (
            <Text style={styles.empty}>Nothing here yet.</Text>
          ) : (
            section.listings.map((listing) => (
              <Button key={listing.id} variant="secondary" onPress={() => onSelectListing(listing)}>
                {listing.name}
              </Button>
            ))
          )}
        </View>
      ))}
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
  section: { gap: 8 },
  sectionHeading: { fontSize: 16, fontWeight: "600" },
  empty: { color: "#666" },
  error: { color: "#b00020" },
});
