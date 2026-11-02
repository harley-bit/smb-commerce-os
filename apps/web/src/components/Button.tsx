import type { ButtonHTMLAttributes } from "react";

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: "primary" | "secondary";
}

/**
 * A real <button type="button">, not a <div onClick>: native keyboard
 * activation (Enter/Space), tab order, and disabled semantics come from the
 * browser, not reimplemented here. All styling goes through the `btn`
 * classes in globals.css — never an inline `style` attribute (CSP
 * `style-src 'self'`, no `unsafe-inline`).
 */
export function Button({ variant = "primary", className, type = "button", ...rest }: ButtonProps) {
  const classes = ["btn", `btn--${variant}`, className].filter(Boolean).join(" ");
  return <button type={type} className={classes} {...rest} />;
}
