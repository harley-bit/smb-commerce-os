import { useState } from "react";
import { ActivityIndicator, Pressable, StyleSheet, Text, TextInput, View } from "react-native";
import { API_BASE_URL } from "./apiConfig";
import { expoPkceAdapter } from "./expoPkceAdapter";
import { ExpoSecureTokenStore } from "./expoSecureTokenStore";
import { refreshSession, signIn, signOut, type AuthClientDeps } from "./authClient";

const storage = new ExpoSecureTokenStore();
const deps: AuthClientDeps = { baseUrl: API_BASE_URL, fetchFn: fetch, storage, pkce: expoPkceAdapter };

type Status = { kind: "idle" } | { kind: "loading" } | { kind: "signedIn" } | { kind: "error"; message: string };

/**
 * `docs/cards/D138.md` — Mobile authentication UI: email/password (+ TOTP
 * code, mandatory for every account per `AuthProvider.authenticate`)
 * against the PKCE authorization-code + refresh flow in
 * `./authClient.ts`. All the actual logic lives there and in `./pkce.ts` /
 * `./secureTokenStore.ts`, which are unit-tested; this component is thin
 * glue with no test of its own (no React Native rendering test harness is
 * set up in this app shell yet, same boundary `App.tsx`'s own D137 shell
 * comment describes for `parseMerchantProfile`).
 */
export function SignInScreen(): React.JSX.Element {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [mfaCode, setMfaCode] = useState("");
  const [status, setStatus] = useState<Status>({ kind: "idle" });

  async function handleSignIn(): Promise<void> {
    setStatus({ kind: "loading" });
    const result = await signIn(deps, email, password, mfaCode || undefined);
    setStatus(result.ok ? { kind: "signedIn" } : { kind: "error", message: result.error });
  }

  async function handleRefresh(): Promise<void> {
    setStatus({ kind: "loading" });
    const ok = await refreshSession(deps);
    setStatus(ok ? { kind: "signedIn" } : { kind: "error", message: "Session expired. Please sign in again." });
  }

  async function handleSignOut(): Promise<void> {
    await signOut(deps);
    setStatus({ kind: "idle" });
  }

  if (status.kind === "signedIn") {
    return (
      <View style={styles.container}>
        <Text style={styles.title}>Signed in</Text>
        <Pressable style={styles.button} onPress={handleRefresh}>
          <Text style={styles.buttonText}>Refresh session</Text>
        </Pressable>
        <Pressable style={styles.button} onPress={handleSignOut}>
          <Text style={styles.buttonText}>Sign out</Text>
        </Pressable>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <Text style={styles.title}>Sign in</Text>
      <TextInput
        style={styles.input}
        placeholder="Email"
        autoCapitalize="none"
        autoComplete="email"
        keyboardType="email-address"
        value={email}
        onChangeText={setEmail}
      />
      <TextInput
        style={styles.input}
        placeholder="Password"
        secureTextEntry
        autoComplete="password"
        value={password}
        onChangeText={setPassword}
      />
      <TextInput
        style={styles.input}
        placeholder="MFA code (if enrolled)"
        keyboardType="number-pad"
        value={mfaCode}
        onChangeText={setMfaCode}
      />
      <Pressable style={styles.button} onPress={handleSignIn} disabled={status.kind === "loading"}>
        {status.kind === "loading" ? <ActivityIndicator /> : <Text style={styles.buttonText}>Sign in</Text>}
      </Pressable>
      {status.kind === "error" ? (
        <Text accessibilityRole="alert" style={styles.error}>
          {status.message}
        </Text>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, justifyContent: "center", padding: 24, gap: 12 },
  title: { fontSize: 20, fontWeight: "600", marginBottom: 8 },
  input: { borderWidth: 1, borderColor: "#ccc", borderRadius: 6, padding: 10 },
  button: { backgroundColor: "#111", borderRadius: 6, padding: 12, alignItems: "center" },
  buttonText: { color: "#fff", fontWeight: "600" },
  error: { color: "#b00020" },
});
