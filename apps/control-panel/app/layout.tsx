import "antd/dist/reset.css";
import "@bthwani/design-system/theme.css";
import { AntdRegistry } from "@ant-design/nextjs-registry";
import { headers } from "next/headers";
import type { ReactNode } from "react";
import { Providers } from "./providers";

export const metadata = { title: "بثواني — تهيئة لوحة التحكم", robots: { index: false, follow: false } };

export default async function RootLayout({ children }: Readonly<{ children: ReactNode }>) {
  // Header access keeps the Operator HTML request-rendered, so the CSP nonce is never cached.
  const nonce = (await headers()).get("x-nonce") ?? "";
  return <html lang="ar" dir="rtl"><body style={{ margin: 0 }}><AntdRegistry><Providers cspNonce={nonce}>{children}</Providers></AntdRegistry></body></html>;
}
