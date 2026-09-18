import { headers } from "next/headers";
import Script from "next/script";
import { connection } from "next/server";
import type { ReactNode } from "react";
import "./globals.css";
import { SessionProvider } from "../src/session/session-provider";

export default async function RootLayout({ children }: Readonly<{ children: ReactNode }>) {
  await connection();
  const nonce = (await headers()).get("x-nonce") ?? undefined;
  return (
    <html lang="ar" dir="rtl" suppressHydrationWarning>
      <head>
        <Script id="appearance-init" nonce={nonce} strategy="beforeInteractive">{`(() => { try { const value = window.localStorage.getItem("bthwani.control-panel.appearance"); if (value === "light" || value === "dark") document.documentElement.dataset.theme = value; } catch {} })();`}</Script>
      </head>
      <body><SessionProvider>{children}</SessionProvider></body>
    </html>
  );
}
