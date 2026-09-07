import type { ReactNode } from "react";
import { connection } from "next/server";
import "./globals.css";

export default async function RootLayout({ children }: Readonly<{ children: ReactNode }>) {
  await connection();
  return (
    <html lang="ar" dir="rtl">
      <body>{children}</body>
    </html>
  );
}
