import { StyleSheet, Text, View } from "react-native";
import { Button } from "../components/Button";
import { toWebPath, type Screen } from "./routes";

export interface PlaceholderScreenProps {
  screen: Screen;
  canGoBack: boolean;
  onGoBack: () => void;
  onNavigate: (screen: Screen) => void;
}

/**
 * `docs/cards/D139.md` — a stand-in body for every core screen except
 * `SignIn`. D140+ replace each of these with the real data-fetching screen
 * (`docs/cards/D140.md` onward); this card's job is only the navigation
 * shell they'll be dropped into, plus proof that a screen can push another
 * screen and come back. Shows the web path this screen mirrors, so
 * navigation parity is visible, not just asserted in `routes.test.ts`.
 */
export function PlaceholderScreen({ screen, canGoBack, onGoBack, onNavigate }: PlaceholderScreenProps) {
  return (
    <View style={styles.container}>
      <Text style={styles.title}>{screen.name}</Text>
      <Text style={styles.subtitle}>mirrors web route {toWebPath(screen)}</Text>
      {canGoBack ? (
        <Button variant="secondary" onPress={onGoBack}>
          Back
        </Button>
      ) : null}
      {screen.name === "Home" ? (
        <>
          <Button
            onPress={() =>
              onNavigate({ name: "ListingDetail", params: { slug: screen.params.slug, listingSlug: "example" } })
            }
          >
            View a listing
          </Button>
          <Button variant="secondary" onPress={() => onNavigate({ name: "AccountOrders", params: screen.params })}>
            My orders
          </Button>
        </>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, justifyContent: "center", padding: 24, gap: 12 },
  title: { fontSize: 20, fontWeight: "600" },
  subtitle: { color: "#666" },
});
