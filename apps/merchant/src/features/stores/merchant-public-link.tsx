import { getPublicStore, publicStorefrontUrl } from "@bthwani/dsh";
import { useMobileAppearance } from "@bthwani/tamagui-config/appearance";
import * as Clipboard from "expo-clipboard";
import { useEffect, useRef, useState } from "react";
import { Platform, Pressable, Share, Text, View } from "react-native";

type SharingAction = "copy" | "share";
type SharingContext = {
  actorId: string;
  storeId: string;
  published: boolean;
  link: string | null;
  native: boolean;
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

// The OS owns its share sheet and clipboard. A handoff is not evidence that
// a recipient received a message. Both actions require the same live proof.
async function deliverPublicLink(action: SharingAction, link: string): Promise<string> {
  if (action === "share") {
    try {
      const result = await Share.share({ message: link });
      if (result.action === Share.sharedAction) return "تم تسليم الرابط إلى واجهة المشاركة.";
      if (result.action === Share.dismissedAction) return "";
    } catch {
      // Copy remains an explicit user action, never an automatic fallback.
    }
    return "تعذّرت المشاركة. يمكنك نسخ الرابط.";
  }
  try {
    if (await Clipboard.setStringAsync(link) === true) return "تم نسخ رابط المتجر المنشور.";
  } catch {
    // The native clipboard may be unavailable.
  }
  return "تعذّر نسخ الرابط إلى الحافظة. أعد المحاولة.";
}

export default function MerchantPublicLink({ actorId, storeId, published }: Readonly<{
  actorId: string;
  storeId: string;
  published: boolean;
}>) {
  const { theme } = useMobileAppearance();
  const link = publicStorefrontUrl(storeId, process.env.EXPO_PUBLIC_BTHWANI_CUSTOMER_WEB_ORIGIN);
  const native = Platform.OS === "android" || Platform.OS === "ios";
  const [view, setView] = useState<SharingView>(idle);
  const latest = useRef<SharingContext | null>(null);
  if (!latest.current || latest.current.actorId !== actorId ||
      latest.current.storeId !== storeId || latest.current.published !== published ||
      latest.current.link !== link || latest.current.native !== native) {
    latest.current = { actorId, storeId, published, link, native, active: false, request: null };
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

  async function act(action: SharingAction) {
    if (!context.active || latest.current !== context || context.request ||
        !context.published || !context.actorId || !context.link ||
        (action === "share" && !context.native)) return;
    const request = new AbortController();
    context.request = request;
    const currentRequest = () => context.active && latest.current === context &&
      context.request === request && !request.signal.aborted;
    setView({ context, busy: true, notice: "" });
    let notice = "";
    try {
      const current = await getPublicStore(discoveryOrigin(), context.storeId, request.signal);
      if (!currentRequest()) return;
      if (current.id !== context.storeId) throw new Error("Unexpected Store projection");
      notice = await deliverPublicLink(action, context.link);
    } catch {
      notice = "تعذّر تأكيد نشر المتجر لدى DSH. لم تتم مشاركة رابط غير متحقق منه.";
    } finally {
      if (currentRequest()) {
        context.request = null;
        setView({ context, busy: false, notice });
      }
    }
  }

  const button = {
    minHeight: 44, padding: 12, borderRadius: 10, borderWidth: 1,
    borderColor: theme.borderColor, opacity: visible.busy ? 0.5 : 1,
  };
  return (
    <View testID="merchant-public-storefront-link" style={{
      gap: 10, padding: 14, backgroundColor: theme.surface,
      borderColor: theme.borderColor, borderWidth: 1, borderRadius: 12,
    }}>
      <Text style={{ color: theme.color, fontWeight: "700" }}>رابط المتجر للعميل</Text>
      <Text style={{ color: theme.colorSecondary }}>
        {published ? "يتحقق بثواني من نشر المتجر لدى DSH قبل نسخ رابطه العام أو مشاركته." :
          "هذا المتجر غير منشور؛ لا يمكن مشاركة رابط عام له."}
      </Text>
      {published && actorId && link ? (
        <>
          <Pressable accessibilityRole="button" accessibilityLabel="نسخ رابط المتجر العام"
            accessibilityState={{ disabled: visible.busy, busy: visible.busy }}
            disabled={visible.busy} onPress={() => void act("copy")} style={button}>
            <Text style={{ color: theme.interactiveText }}>نسخ رابط المتجر</Text>
          </Pressable>
          {native ? (
            <Pressable accessibilityRole="button" accessibilityLabel="مشاركة رابط المتجر العام"
              accessibilityState={{ disabled: visible.busy, busy: visible.busy }}
              disabled={visible.busy} onPress={() => void act("share")} style={button}>
              <Text style={{ color: theme.interactiveText }}>مشاركة رابط المتجر</Text>
            </Pressable>
          ) : null}
          {visible.busy ? <Text accessibilityLiveRegion="polite"
            style={{ color: theme.colorSecondary }}>جارٍ تجهيز الرابط…</Text> : null}
        </>
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
