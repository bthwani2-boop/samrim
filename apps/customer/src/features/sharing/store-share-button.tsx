import { getPublicStore } from "@bthwani/dsh";
import { useMobileAppearance } from "@bthwani/tamagui-config/appearance";
import { useEffect, useRef, useState } from "react";
import { Platform, Pressable, Share, Text, View } from "react-native";
import { publicStorefrontShareUrl, verifyStorefrontShare } from "./store-share";

export default function StoreShareButton({ storeId, ownerOrigin }: Readonly<{
  storeId: string;
  ownerOrigin: string;
}>) {
  const { theme } = useMobileAppearance();
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState("");
  const pending = useRef<AbortController | null>(null);
  const active = useRef(false);
  const origin = process.env.EXPO_PUBLIC_BTHWANI_CUSTOMER_WEB_ORIGIN ??
    (Platform.OS === "web" && typeof window !== "undefined" ? window.location.origin : "");

  useEffect(() => {
    active.current = true;
    return () => {
      active.current = false;
      pending.current?.abort();
      pending.current = null;
    };
  }, []);

  const validUrl = publicStorefrontShareUrl(storeId, origin);
  async function shareStore() {
    if (!active.current || pending.current || !validUrl) return;
    const request = new AbortController();
    pending.current = request;
    const isCurrent = () => active.current && pending.current === request && !request.signal.aborted;
    setBusy(true);
    setNotice("");
    try {
      const url = await verifyStorefrontShare(storeId, origin,
        (id, signal) => getPublicStore(ownerOrigin, id, signal), request.signal);
      if (!isCurrent() || !url) return;
      try {
        if (Platform.OS === "web") {
          if (typeof navigator === "undefined" || !navigator.clipboard) throw new Error("Clipboard unavailable");
          await navigator.clipboard.writeText(url);
          if (isCurrent()) setNotice("تم نسخ رابط المتجر المنشور.");
        } else {
          await Share.share({ message: url });
        }
      } catch {
        if (isCurrent()) setNotice("تعذّرت مشاركة الرابط. حاول مجددًا.");
      }
    } catch {
      if (isCurrent()) setNotice("تعذّر التحقق من نشر المتجر لدى DSH. لم تتم مشاركة الرابط.");
    } finally {
      if (isCurrent()) {
        pending.current = null;
        setBusy(false);
      }
    }
  }
  return <View style={{ gap: 6 }}>
    <Pressable testID="customer-share-store" accessibilityRole="button" accessibilityLabel="مشاركة رابط المتجر"
      accessibilityState={{ disabled: !validUrl || busy, busy }} disabled={!validUrl || busy}
      onPress={() => void shareStore()}
      style={{ minHeight: 44, padding: 12, borderWidth: 1, borderColor: theme.borderColor, borderRadius: 10 }}>
      <Text style={{ color: theme.interactiveText }}>{busy ? "جارٍ التحقق من النشر…" : Platform.OS === "web" ? "نسخ رابط المتجر" : "مشاركة المتجر"}</Text>
    </Pressable>
    {!validUrl ? <Text style={{ color: theme.colorSecondary }}>رابط واجهة العميل غير مضبوط للمشاركة.</Text> : null}
    {notice ? <Text accessibilityLiveRegion="polite" style={{ color: theme.colorSecondary }}>{notice}</Text> : null}
  </View>;
}
