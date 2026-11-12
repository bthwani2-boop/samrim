import "antd/dist/reset.css";
import "@bthwani/design-system/theme.css";
import type { ReactNode } from "react";
import { AntdRegistry } from "@ant-design/nextjs-registry";
import { Providers } from "./providers";

export const metadata = { title: "بثواني — تهيئة لوحة التحكم", robots: { index: false, follow: false } };

export default function RootLayout({ children }: Readonly<{ children: ReactNode }>) {
  return <html lang="ar" dir="rtl"><body style={{ margin: 0 }}><AntdRegistry><Providers>{children}</Providers></AntdRegistry></body></html>;
}
