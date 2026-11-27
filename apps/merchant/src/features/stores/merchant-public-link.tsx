import { getPublicStore } from "@bthwani/dsh";
import { useMobileAppearance } from "@bthwani/tamagui-config/appearance";
import * as Clipboard from "expo-clipboard";
import { useEffect, useRef, useState } from "react";
import { Platform, Pressable, Text, View } from "react-native";
import { publicStorefrontLink } from "./public-storefront-link";

type SharingContext = {
  actorId: string;
  storeId: string;
  published: boolean;
  active: boolean;
  request: AbortController | null;
};
type SharingView = { context: SharingContext | null; busy: boolean; notice: string };
const idle: SharingView = { context: null, busy: false, notice: "" };

function discoveryOrigin() {
  return Platform.OS === "web"
    ? (typeof window === "undefined" ? "" : window.location.origin)
    : process.env.EXPO_PUBLIC_MERCHANT_SYNTHETIC_DSH_ORIGIN ?? "";
}

export default function MerchantPublicLink({ actorId, storeId, published }: Readonly<{
  actorId: string;
  storeId: string;
  published: boolean;
}>) {
  const { theme } = useMobileAppearance();
  const link = publicStorefrontLink(storeId, process.env.EXPO_PUBLIC_BTHWANI_CUSTOMER_WEB_ORIGIN);
  const [view, setView] = useState<SharingView>(idle);
  const latest = useRef<SharingContext | null>(null);
  if (!latest.current || latest.current.actorId !== actorId ||
      latest.current.storeId !== storeId || latest.current.published !== published) {
    latest.current = { actorId, storeId, published, active: false, request: null };
  }
  const context = latest.current;
  const visible = view.context === context ? view : idle;

  useEffect(() => {
    context.active = true;
    return () => {
      context.active = false;
      context.request?.abort();
      context.request = null;
    };
  }, [context]);

  const isCurrent = () => context.active && latest.current === context;

  async function copyPublicLink() {
    if (!isCurrent() || context.request || !context.published || !context.actorId || !link) return;
    const request = new AbortController();
    context.request = request;
    const currentRequest = () => isCurrent() && context.request === request && !request.signal.aborted;
    setView({ context, busy: true, notice: "" });
    let notice = "";
    try {
      const current = await getPublicStore(discoveryOrigin(), context.storeId, request.signal);
      if (!currentRequest()) return;
      if (current.id !== context.storeId) throw new Error("Unexpected Store projection");
      try {
        notice = await Clipboard.setStringAsync(link) === true
          ? "تم نسخ رابط المتجر المنشور."
          : "تعذّر نسخ الرابط إلى الحافظة. أعد المحاولة.";
      } catch {
        notice = "تعذّر نسخ الرابط إلى الحافظة. أعد المحاولة.";
      }
    } catch {
      notice = "تعذّر تأكيد نشر المتجر لدى DSH. لم يُنسخ رابط غير متحقق منه.";
    } finally {
      if (currentRequest()) {
        context.request = null;
        setView({ context, busy: false, notice });
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
      {published && actorId && link ? (
        <Pressable accessibilityRole="button" accessibilityLabel="نسخ رابط المتجر العام"
          disabled={visible.busy} onPress={() => void copyPublicLink()}
          style={{ minHeight: 44, padding: 12, borderRadius: 10, borderWidth: 1,
            borderColor: theme.borderColor, opacity: visible.busy ? 0.5 : 1 }}>
          <Text style={{ color: theme.interactiveText }}>
            {visible.busy ? "جارٍ التحقق من النشر…" : "نسخ رابط المتجر"}
          </Text>
        </Pressable>
      ) : null}
      {published && !link ? (
        <Text accessibilityRole="alert" style={{ color: theme.warningText }}>
          رابط واجهة العميل غير مضبوط أو غير موثوق. لا يمكن مشاركة المتجر قبل ضبطه.
        </Text>
      ) : null}
      {visible.notice ? <Text accessibilityLiveRegion="polite" style={{ color: theme.color }}>{visible.notice}</Text> : null}
    </View>
  );
}
