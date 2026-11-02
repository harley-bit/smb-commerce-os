import { ActivityIndicator, Pressable, StyleSheet, Text, type PressableProps } from "react-native";

export interface ButtonProps extends Omit<PressableProps, "children" | "style"> {
  variant?: "primary" | "secondary";
  loading?: boolean;
  children: string;
}

/**
 * `docs/cards/D139.md` — the RN counterpart to `apps/web/src/components/Button.tsx`:
 * same `variant` prop (`primary`/`secondary`), same disabled semantics
 * (native `Pressable` `disabled`, not a manually-guarded `onPress`), so a
 * screen built against this component behaves like its web equivalent
 * rather than reinventing button behaviour per screen the way
 * `SignInScreen.tsx`'s original inline `Pressable` did.
 */
export function Button({ variant = "primary", loading = false, disabled, children, ...rest }: ButtonProps) {
  const isDisabled = disabled === true || loading;
  return (
    <Pressable
      accessibilityRole="button"
      disabled={isDisabled}
      style={({ pressed }) => [
        styles.base,
        variant === "primary" ? styles.primary : styles.secondary,
        isDisabled && styles.disabled,
        pressed && !isDisabled && styles.pressed,
      ]}
      {...rest}
    >
      {loading ? (
        <ActivityIndicator color={variant === "primary" ? "#fff" : "#111"} />
      ) : (
        <Text style={variant === "primary" ? styles.primaryText : styles.secondaryText}>{children}</Text>
      )}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  base: { borderRadius: 6, paddingVertical: 12, paddingHorizontal: 16, alignItems: "center" },
  primary: { backgroundColor: "#111" },
  secondary: { backgroundColor: "transparent", borderWidth: 1, borderColor: "#111" },
  disabled: { opacity: 0.5 },
  pressed: { opacity: 0.8 },
  primaryText: { color: "#fff", fontWeight: "600" },
  secondaryText: { color: "#111", fontWeight: "600" },
});
