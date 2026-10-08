import type { Metadata } from "next";
import type { ReactNode } from "react";

export const metadata: Metadata = { title: "طلبات سحب العملاء الاستثنائية" };

export default function CustomerWithdrawalsRouteLayout({ children }: Readonly<{ children: ReactNode }>) {
  return children;
}
