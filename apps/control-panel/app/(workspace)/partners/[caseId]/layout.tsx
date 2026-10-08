import type { Metadata } from "next";
import type { ReactNode } from "react";

export const metadata: Metadata = { title: "تفاصيل طلب الانضمام" };

export default function PartnerCaseRouteLayout({ children }: Readonly<{ children: ReactNode }>) {
  return children;
}
