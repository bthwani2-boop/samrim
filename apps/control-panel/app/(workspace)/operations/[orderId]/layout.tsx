import type { Metadata } from "next";
import type { ReactNode } from "react";

export const metadata: Metadata = { title: "تفاصيل الطلب" };

export default function OrderDetailRouteLayout({ children }: Readonly<{ children: ReactNode }>) {
  return children;
}
