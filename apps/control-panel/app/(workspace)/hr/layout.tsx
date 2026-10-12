import type { Metadata } from "next";
import type { ReactNode } from "react";
export const metadata: Metadata = { title: "الموارد البشرية" };
export default function HRLayout({ children }: Readonly<{ children: ReactNode }>) { return children; }
