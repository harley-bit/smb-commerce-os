import type { ReactNode } from "react";

export const metadata = {
  title: "SMB Commerce OS — Merchant Dashboard",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
