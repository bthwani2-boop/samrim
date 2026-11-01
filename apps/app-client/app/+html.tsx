import { ScrollViewStyleReset, useServerDocumentContext } from "expo-router/html";
import type { ReactNode } from "react";

// Preserve server-generated metadata and hydration scripts for Expo SDK 58 SSR.
export default function RootHtml({ children }: { children: ReactNode }) {
  const { htmlAttributes, bodyAttributes, headNodes, bodyNodes } = useServerDocumentContext();
  return <html {...htmlAttributes} lang="ar" dir="rtl">
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
  </html>;
}
