import type { Metadata } from "next";
import type { ReactNode } from "react";

export const metadata: Metadata = { title: "العمليات" };

export default function OperationsRouteLayout({ children }: Readonly<{ children: ReactNode }>) {
  return children;
}
