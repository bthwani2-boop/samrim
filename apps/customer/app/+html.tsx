import type { ReactNode } from "react";
import { ScrollViewStyleReset } from "expo-router/html";

// Expo Router web document metadata is separate from the mobile RTL native
// config. Do not leave its default <html lang="en"> on Arabic-first surfaces.
export default function HtmlDocument({ children }: Readonly<{ children: ReactNode }>) {
  return (
    <html lang="ar" dir="rtl">
      <head>
        <meta charSet="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <ScrollViewStyleReset />
      </head>
      <body>{children}</body>
    </html>
  );
}
