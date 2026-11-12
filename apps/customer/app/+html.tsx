import type { ReactNode } from "react";
import { ScrollViewStyleReset, useServerDocumentContext } from "expo-router/html";

// Expo SDK 58 requires the generated head/body nodes for metadata and hydration.
export default function HtmlDocument({ children }: Readonly<{ children: ReactNode }>) {
  const { htmlAttributes, bodyAttributes, headNodes, bodyNodes } = useServerDocumentContext();
  return (
    <html {...htmlAttributes} lang="ar" dir="rtl">
      <head>
        <meta charSet="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <ScrollViewStyleReset />
        {headNodes}
      </head>
      <body {...bodyAttributes}>
        {children}
        {bodyNodes}
      </body>
    </html>
  );
}
