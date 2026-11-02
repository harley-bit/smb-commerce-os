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
 * `SignIn` and (since `docs/cards/D140.md`) `Home`, which `App.tsx` now
 * routes to the real `../merchant/HomeScreen.tsx` instead. D141+ replace
 * the rest with their own real data-fetching screens; this remains their
 * navigation shell until then, plus proof that a screen can push another
 * screen and come back. Shows the web path this screen mirrors, so
 * navigation parity is visible, not just asserted in `routes.test.ts`.
 */
export function PlaceholderScreen({ screen, canGoBack, onGoBack }: PlaceholderScreenProps) {
  return (
    <View style={styles.container}>
      <Text style={styles.title}>{screen.name}</Text>
      <Text style={styles.subtitle}>mirrors web route {toWebPath(screen)}</Text>
      {canGoBack ? (
        <Button variant="secondary" onPress={onGoBack}>
          Back
        </Button>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, justifyContent: "center", padding: 24, gap: 12 },
  title: { fontSize: 20, fontWeight: "600" },
  subtitle: { color: "#666" },
});
