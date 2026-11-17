import type { Metadata } from "expo-router/server";
import PublicStoresScreen from "../../src/features/stores/stores-screen";

export function generateMetadata(): Metadata {
  return { title: "بثواني — الرئيسية", description: "استعرض المتاجر والعروض المنشورة عبر بثواني." };
}

export default function CustomerHome() {
  return <PublicStoresScreen variant="home" />;
}
