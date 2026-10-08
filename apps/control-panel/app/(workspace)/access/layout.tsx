import type { Metadata } from "next";
import type { ReactNode } from "react";

export const metadata: Metadata = { title: "الوصول والصلاحيات" };

export default function AccessRouteLayout({ children }: Readonly<{ children: ReactNode }>) {
  return children;
}
