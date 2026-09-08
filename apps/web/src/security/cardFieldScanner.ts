/**
 * PCI SAQ A eligibility (`docs/design/07`) depends on card data never
 * reaching a field we render ourselves — only Stripe hosted fields
 * (Elements / Checkout), which live in Stripe's iframe or mount to an
 * unlabeled `<div>`. This scanner is a static tripwire: it flags any
 * `<input>` in our own source that carries a card-data `autocomplete`
 * token or a card-shaped `name`/`id`, since that is the only way a raw
 * PAN/CVC field could end up in our DOM. Widening the platform's SAQ
 * scope this way requires an ADR, not a passing test.
 */
export interface CardFieldViolation {
  file: string;
  line: number;
  snippet: string;
  reason: string;
}

const CARD_AUTOCOMPLETE_PATTERN =
  /autocomplete\s*=\s*["'][^"']*\bcc-(?:number|csc|exp|exp-month|exp-year|name|type)\b[^"']*["']/i;

const CARD_IDENTIFIER_PATTERN =
  /\b(?:name|id)\s*=\s*["'][^"']*\b(?:card[-_]?number|cc[-_]?number|cvv\d?|cvc\d?|card[-_]?cvc|security[-_]?code|card[-_]?expir\w*|pan)\b[^"']*["']/i;

export function scanSourceForCardFields(filePath: string, source: string): CardFieldViolation[] {
  const violations: CardFieldViolation[] = [];

  source.split("\n").forEach((line, index) => {
    if (!/<input\b/i.test(line)) return;
    if (!CARD_AUTOCOMPLETE_PATTERN.test(line) && !CARD_IDENTIFIER_PATTERN.test(line)) return;

    violations.push({
      file: filePath,
      line: index + 1,
      snippet: line.trim(),
      reason:
        "raw card input field detected — PCI SAQ A requires Stripe hosted fields, never our own <input> for card data",
    });
  });

  return violations;
}
