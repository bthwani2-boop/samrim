import type { ReactNode } from "react";
import { connection } from "next/server";
import Script from "next/script";
import "./globals.css";
import { SessionProvider } from "../src/session/session-provider";

export default async function RootLayout({ children }: Readonly<{ children: ReactNode }>) {
  await connection();
  return (
    <html lang="ar" dir="rtl" suppressHydrationWarning>
      <head>
        <Script id="appearance-init" strategy="beforeInteractive">{`(() => { try { const value = window.localStorage.getItem("bthwani.control-panel.appearance"); if (value === "light" || value === "dark") { document.documentElement.dataset.theme = value; document.documentElement.style.colorScheme = value; } } catch {} })();`}</Script>
      </head>
      <body><SessionProvider>{children}</SessionProvider></body>
    </html>
  );
}
