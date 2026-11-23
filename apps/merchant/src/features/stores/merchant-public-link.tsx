import { getPublicStore } from "@bthwani/dsh";
import { useMobileAppearance } from "@bthwani/tamagui-config/appearance";
import * as Clipboard from "expo-clipboard";
import { useEffect, useRef, useState } from "react";
import { Platform, Pressable, Text, View } from "react-native";
import { publicStorefrontLink } from "./public-storefront-link";

const ownerOrigin = Platform.OS === "web"
  ? (typeof window === "undefined" ? "" : window.location.origin)
  : process.env.EXPO_PUBLIC_MERCHANT_SYNTHETIC_DSH_ORIGIN ?? "";
const customerOrigin = process.env.EXPO_PUBLIC_BTHWANI_CUSTOMER_WEB_ORIGIN;

export default function MerchantPublicLink({ actorId, storeId, published }: Readonly<{
  actorId: string;
  storeId: string;
  published: boolean;
}>) {
  const { theme } = useMobileAppearance();
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState("");
  const controller = useRef<AbortController | null>(null);
  const latest = useRef({ actorId, storeId, published });
  latest.current = { actorId, storeId, published };
  const link = publicStorefrontLink(storeId, customerOrigin);

  // biome-ignore lint/correctness/useExhaustiveDependencies: Actor, Store and publication changes revoke in-flight link requests.
  useEffect(() => {
    setBusy(false);
    setNotice("");
    return () => {
      controller.current?.abort();
      controller.current = null;
    };
  }, [actorId, storeId, published]);

  async function copyPublicLink() {
    if (controller.current || !published || !actorId || !link) return;
    const request = new AbortController();
    controller.current = request;
    setBusy(true);
    setNotice("");
    try {
      // Public publication can change after the authenticated Merchant's DSH
      // standing was read. Recheck with the real public owner before sharing.
      const current = await getPublicStore(ownerOrigin, storeId, request.signal);
      if (request.signal.aborted || current.id !== storeId ||
          latest.current.actorId !== actorId || latest.current.storeId !== storeId ||
          !latest.current.published) return;
      await Clipboard.setStringAsync(link);
      if (!request.signal.aborted && latest.current.actorId === actorId &&
          latest.current.storeId === storeId && latest.current.published) {
        setNotice("تم نسخ رابط المتجر المنشور.");
      }
    } catch {
      if (!request.signal.aborted) {
        setNotice("تعذّر تأكيد نشر المتجر لدى DSH. لم يُنسخ رابط غير متحقق منه.");
      }
    } finally {
      if (controller.current === request) {
        controller.current = null;
        setBusy(false);
      }
    }
  }

  return (
    <View testID="merchant-public-storefront-link" style={{
      gap: 10, padding: 14, backgroundColor: theme.surface,
      borderColor: theme.borderColor, borderWidth: 1, borderRadius: 12,
    }}>
      <Text style={{ color: theme.color, fontWeight: "700" }}>رابط المتجر للعميل</Text>
      <Text style={{ color: theme.colorSecondary }}>
        {published ? "يتحقق بثواني من نشر المتجر لدى DSH قبل نسخ رابطه العام." :
          "هذا المتجر غير منشور؛ لا يمكن مشاركة رابط عام له."}
      </Text>
      {published && link ? (
        <Pressable accessibilityRole="button" accessibilityLabel="نسخ رابط المتجر العام"
          disabled={busy} onPress={() => void copyPublicLink()}
          style={{ minHeight: 44, padding: 12, borderRadius: 10, borderWidth: 1,
            borderColor: theme.borderColor, opacity: busy ? 0.5 : 1 }}>
          <Text style={{ color: theme.interactiveText }}>
            {busy ? "جارٍ التحقق من النشر…" : "نسخ رابط المتجر"}
          </Text>
        </Pressable>
      ) : null}
      {published && !link ? (
        <Text accessibilityRole="alert" style={{ color: theme.warningText }}>
          رابط واجهة العميل غير مضبوط أو غير موثوق. لا يمكن مشاركة المتجر قبل ضبطه.
        </Text>
      ) : null}
      {notice ? <Text accessibilityLiveRegion="polite" style={{ color: theme.color }}>{notice}</Text> : null}
    </View>
  );
}
