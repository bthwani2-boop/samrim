import { Link } from "expo-router";
import { useMobileAppearance } from "@bthwani/tamagui-config/appearance";
import { Stage4Preview } from "@bthwani/tamagui-config/preview";

export default function FoundationHome() {
  const { theme } = useMobileAppearance();
  return (
    <Stage4Preview
      title="بثواني — الكابتن"
      healthLink={<Link href="/health" style={{ color: theme.interactiveText, fontSize: 18 }}>فتح صفحة اختبار الملاحة</Link>}
    />
  );
}
