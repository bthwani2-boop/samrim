import { Redirect } from "expo-router";
import type { Metadata } from "expo-router/server";

export function generateMetadata(): Metadata {
  return { title: "متاجر بثواني — العميل", description: "استعراض المتاجر والعروض المنشورة في بثواني." };
}

export default function CustomerHome() {
  return <Redirect href="/stores" />;
}
