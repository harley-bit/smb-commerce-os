import { useState } from "react";
import { StyleSheet, Text, View } from "react-native";
import { Button } from "../components/Button";
import { TextField } from "../components/TextField";
import { API_BASE_URL } from "./apiConfig";
import { expoPkceAdapter } from "./expoPkceAdapter";
import { ExpoSecureTokenStore } from "./expoSecureTokenStore";
import { refreshSession, signIn, signOut, type AuthClientDeps } from "./authClient";

const storage = new ExpoSecureTokenStore();
const deps: AuthClientDeps = { baseUrl: API_BASE_URL, fetchFn: fetch, storage, pkce: expoPkceAdapter };

type Status = { kind: "idle" } | { kind: "loading" } | { kind: "signedIn" } | { kind: "error"; message: string };

export interface SignInScreenProps {
  onSignedIn?: () => void;
}

/**
 * `docs/cards/D138.md` — Mobile authentication UI: email/password (+ TOTP
 * code, mandatory for every account per `AuthProvider.authenticate`)
 * against the PKCE authorization-code + refresh flow in `./authClient.ts`.
 * All the actual logic lives there and in `./pkce.ts` / `./secureTokenStore.ts`,
 * which are unit-tested; this component is thin glue with no test of its
 * own (no React Native rendering test harness is set up in this app shell
 * yet, same boundary `App.tsx`'s own D137 shell comment describes for
 * `parseMerchantProfile`).
 *
 * `docs/cards/D139.md` — now built from the shared `Button`/`TextField`
 * (component parity with `apps/web/src/components`) instead of inline
 * `Pressable`/`TextInput`, and reports a successful sign-in to
 * `onSignedIn` so `App.tsx`'s navigation stack can leave the `SignIn`
 * screen.
 */
export function SignInScreen({ onSignedIn }: SignInScreenProps): React.JSX.Element {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [mfaCode, setMfaCode] = useState("");
  const [status, setStatus] = useState<Status>({ kind: "idle" });

  async function handleSignIn(): Promise<void> {
    setStatus({ kind: "loading" });
    const result = await signIn(deps, email, password, mfaCode || undefined);
    if (result.ok) {
      setStatus({ kind: "signedIn" });
      onSignedIn?.();
    } else {
      setStatus({ kind: "error", message: result.error });
    }
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
        <Button variant="secondary" onPress={handleRefresh}>
          Refresh session
        </Button>
        <Button variant="secondary" onPress={handleSignOut}>
          Sign out
        </Button>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <Text style={styles.title}>Sign in</Text>
      <TextField
        label="Email"
        autoCapitalize="none"
        autoComplete="email"
        keyboardType="email-address"
        value={email}
        onChangeText={setEmail}
      />
      <TextField label="Password" secureTextEntry autoComplete="password" value={password} onChangeText={setPassword} />
      <TextField label="MFA code (if enrolled)" keyboardType="number-pad" value={mfaCode} onChangeText={setMfaCode} />
      <Button onPress={handleSignIn} loading={status.kind === "loading"}>
        Sign in
      </Button>
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
  error: { color: "#b00020" },
});
