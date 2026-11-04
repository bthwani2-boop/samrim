import { redirect } from "next/navigation";

export default function CatalogActivityPage() {
  redirect("/catalog?catalogView=activity");
}

export const metadata = { title: "سجل نشاط الكتالوج" };
