import { Link } from "expo-router";
import type { Metadata } from "expo-router/server";

export function generateMetadata(): Metadata {
  return { title: "بثواني — التاجر", description: "واجهة التاجر الخاصة بمنصة بثواني." };
}

import { useMobileAppearance } from "@bthwani/tamagui-config/appearance";
import { Stage4Preview } from "@bthwani/tamagui-config/preview";

export default function FoundationHome() {
  const { theme } = useMobileAppearance();
  return (
    <Stage4Preview
      title="بثواني — التاجر"
      healthLink={<Link href="/health" style={{ color: theme.interactiveText, fontSize: 18 }}>فتح صفحة اختبار الملاحة</Link>}
    />
  );
}
