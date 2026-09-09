import type { ReactNode } from "react";
import { headers } from "next/headers";
import "../styles/globals.css";

export const metadata = {
  title: "SMB Commerce OS — Merchant Dashboard",
};

export default async function RootLayout({ children }: { children: ReactNode }) {
  // middleware.ts sets this per request (see security/csp.ts); passing it
  // as the <html> nonce lets Next apply it to its own framework-injected
  // scripts so they satisfy the strict CSP without `unsafe-inline`.
  const nonce = (await headers()).get("x-nonce") ?? undefined;

  return (
    <html lang="en" nonce={nonce}>
      <body>{children}</body>
    </html>
  );
}
