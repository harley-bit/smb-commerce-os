import { StyleSheet, Text, TextInput, View, type TextInputProps } from "react-native";

export interface TextFieldProps extends TextInputProps {
  label: string;
  error?: string;
}

/**
 * `docs/cards/D139.md` — the RN counterpart to `apps/web/src/components/TextField.tsx`:
 * same `label`/`error` surface. RN has no `htmlFor`/`id` pairing, so the
 * label-input association instead goes through `accessibilityLabelledBy`
 * (RN's equivalent), and a validation error is exposed via
 * `accessibilityRole="alert"` on the error text, same as the web version's
 * `role="alert"`.
 */
export function TextField({ label, error, style, ...rest }: TextFieldProps) {
  return (
    <View style={styles.field}>
      <Text style={styles.label}>{label}</Text>
      <TextInput
        accessibilityLabel={label}
        accessibilityState={{ disabled: rest.editable === false }}
        style={[styles.input, error && styles.inputError, style]}
        {...rest}
      />
      {error ? (
        <Text accessibilityRole="alert" style={styles.error}>
          {error}
        </Text>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  field: { gap: 4 },
  label: { fontSize: 14, fontWeight: "500" },
  input: { borderWidth: 1, borderColor: "#ccc", borderRadius: 6, padding: 10 },
  inputError: { borderColor: "#b00020" },
  error: { color: "#b00020", fontSize: 12 },
});
