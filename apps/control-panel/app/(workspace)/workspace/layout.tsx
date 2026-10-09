import type { Metadata } from "next";
import type { ReactNode } from "react";

export const metadata: Metadata = { title: "الرئيسية" };

export default function OperatorHomeRouteLayout({ children }: Readonly<{ children: ReactNode }>) {
  return children;
}
