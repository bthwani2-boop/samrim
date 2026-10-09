import type { Metadata } from "next";
import type { ReactNode } from "react";

export const metadata: Metadata = { title: { absolute: "طلبات سحب العملاء الاستثنائية | بثواني" } };

export default function CustomerWithdrawalsRouteLayout({ children }: Readonly<{ children: ReactNode }>) {
  return children;
}
