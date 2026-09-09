import { StatusBar } from "expo-status-bar";
import { StyleSheet, Text, View } from "react-native";
import { parseMerchantProfile } from "./src/shell/parseMerchantProfile";
import { SignInScreen } from "./src/auth/SignInScreen";

/**
 * D137's app shell: no real network call yet (that's the mobile customer
 * flows in later Phase 8 cards), just proof that this shell already speaks
 * `@smb-os/contracts`'s shared Zod schemas instead of a mobile-only copy.
 */
const placeholderProfile = parseMerchantProfile({
  name: "SMB Commerce OS",
  slug: "smb-commerce-os",
  defaultCurrency: "USD",
});

export default function App() {
  return (
    <View style={styles.container}>
      <Text style={styles.title}>
        {placeholderProfile.ok ? placeholderProfile.profile.name : "Unable to load merchant"}
      </Text>
      <Text style={styles.subtitle}>Mobile app shell — Phase 8</Text>
      <View style={styles.authSection}>
        <SignInScreen />
      </View>
      <StatusBar style="auto" />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: "#fff",
    alignItems: "center",
    justifyContent: "center",
  },
  title: {
    fontSize: 20,
    fontWeight: "600",
  },
  subtitle: {
    marginTop: 8,
    color: "#666",
  },
  authSection: {
    width: "100%",
    marginTop: 24,
  },
});
