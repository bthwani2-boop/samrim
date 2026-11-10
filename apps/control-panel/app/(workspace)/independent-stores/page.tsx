import { redirect } from "next/navigation";

export default function IndependentStoresPage() {
  redirect("/partners?tab=directory&relationModel=INDEPENDENT_STORE");
}

export const metadata = { title: "المتاجر المستقلة" };
