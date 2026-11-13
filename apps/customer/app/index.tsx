import { Link } from "expo-router";
import type { Metadata } from "expo-router/server";

export function generateMetadata(): Metadata {
  return { title: "بثواني — العميل", description: "بثواني، تجربة العميل على الويب والأجهزة." };
}

import { useMobileAppearance } from "@bthwani/tamagui-config/appearance";
import { Stage4Preview } from "@bthwani/tamagui-config/preview";

export default function FoundationHome() {
  const { theme } = useMobileAppearance();
  return (
    <Stage4Preview
      title="بثواني — العميل"
      healthLink={<Link href="/health" style={{ color: theme.interactiveText, fontSize: 18 }}>فتح صفحة اختبار الملاحة</Link>}
      labLink={<><Link href="/lab">فتح مختبر مكونات Tamagui</Link><Link href={{ pathname: "/lab", params: { renderer: "universal" } }}>مقارنة Expo UI Universal</Link></>}
    />
  );
}
