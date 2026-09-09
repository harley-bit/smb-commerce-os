/**
 * `docs/cards/D146.md` — mobile equivalent of
 * `apps/web/src/security/cardFieldScanner.ts`'s PCI SAQ A tripwire, adapted
 * from web's `<input>` element to React Native's `<TextInput>`. Card data
 * must never reach a `TextInput` we render ourselves — only the native
 * Stripe mobile SDK's own `CardField` (a native view, not a `TextInput`),
 * which `./HostedCardField.tsx` stands in for in this repo's still-simulated
 * payments posture. Widening this scope requires an ADR, not a passing test.
 */
export interface CardFieldViolation {
  file: string;
  line: number;
  snippet: string;
  reason: string;
}

const CARD_CONTENT_TYPE_PATTERN = /textContentType\s*=\s*["']creditCard\w*["']/i;

const CARD_AUTOCOMPLETE_PATTERN = /autoComplete\s*=\s*["'][^"']*\bcc-(?:number|csc|exp|exp-month|exp-year|name|type)\b[^"']*["']/i;

const CARD_IDENTIFIER_PATTERN =
  /\b(?:testID|name|id)\s*=\s*["'][^"']*\b(?:card[-_]?number|cc[-_]?number|cvv\d?|cvc\d?|card[-_]?cvc|security[-_]?code|card[-_]?expir\w*|pan)\b[^"']*["']/i;

export function scanSourceForCardFields(filePath: string, source: string): CardFieldViolation[] {
  const violations: CardFieldViolation[] = [];

  source.split("\n").forEach((line, index) => {
    if (!/<TextInput\b/i.test(line)) return;
    if (
      !CARD_CONTENT_TYPE_PATTERN.test(line) &&
      !CARD_AUTOCOMPLETE_PATTERN.test(line) &&
      !CARD_IDENTIFIER_PATTERN.test(line)
    ) {
      return;
    }

    violations.push({
      file: filePath,
      line: index + 1,
      snippet: line.trim(),
      reason:
        "raw card TextInput detected — PCI SAQ A requires the native Stripe mobile SDK's hosted CardField, never our own TextInput for card data",
    });
  });

  return violations;
}
