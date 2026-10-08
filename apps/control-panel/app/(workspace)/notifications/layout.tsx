import type { Metadata } from "next";
import type { ReactNode } from "react";

export const metadata: Metadata = { title: "الإشعارات" };

export default function NotificationsRouteLayout({ children }: Readonly<{ children: ReactNode }>) {
  return children;
}
