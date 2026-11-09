import { BthwaniButton, useAppearanceTheme } from "@bthwani/design-system/native";
import type { PartnerAccessibleStore } from "@bthwani/dsh";
import * as Clipboard from "expo-clipboard";
import { useMemo, useState } from "react";
import { Linking, Platform, Share, Text, View } from "react-native";

import { createPartnerSurfaceStyles } from "./partner-surface-styles";
import { buildPartnerStorefrontURL, buildPartnerStoreWhatsAppURL } from "./partner-storefront-url";
import { usePartnerIndependentPublicLink } from "./use-partner-independent-public-link";

export function PartnerStorefrontLink({ store }: Readonly<{ store: PartnerAccessibleStore }>) {
  const theme = useAppearanceTheme();
  const styles = useMemo(() => createPartnerSurfaceStyles(theme), [theme]);
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);
  const independent = store.relationModel === "INDEPENDENT_STORE";
  const publicIndependent = usePartnerIndependentPublicLink(independent ? store : null);
  const link = independent ? publicIndependent.link :
    buildPartnerStorefrontURL(store, process.env.EXPO_PUBLIC_CLIENT_WEB_ORIGIN, __DEV__);
  const whatsAppURL = buildPartnerStoreWhatsAppURL(link, store.name);

  async function copy() {
    if (!link || busy) return;
    setBusy(true);
    setNotice("");
    try {
      await Clipboard.setStringAsync(link.url);
      setNotice(link.previewOnly ? "تم نسخ رابط التطوير المحلي." : "تم نسخ رابط المتجر.");
    } catch {
      setNotice("تعذر نسخ الرابط. أعد المحاولة.");
    } finally {
      setBusy(false);
    }
  }
  async function open() {
    if (!link || busy) return;
    try { await Linking.openURL(link.url); }
    catch { setNotice("تعذر فتح الرابط. تحقق من الاتصال ثم أعد المحاولة."); }
  }
  async function share() {
    if (!link || link.previewOnly || busy) return;
    try { await Share.share({ title: store.name, message: store.name + "\n" + link.url }); }
    catch { setNotice("تعذرت المشاركة. يمكنك نسخ الرابط بدلاً منها."); }
  }
  async function shareViaWhatsApp() {
    if (!whatsAppURL || busy) return;
    setNotice("");
    try { await Linking.openURL(whatsAppURL); }
    catch { setNotice("تعذر فتح واتساب. يمكنك نسخ رابط المتجر ومشاركته يدويًا."); }
  }

  return <View style={styles.card}>
    <Text style={styles.value}>رابط متجر {store.name}</Text>
    {independent && !link ? <Text style={styles.muted}>
      {publicIndependent.checking
        ? "جارٍ التحقق من نشر موقع المتجر المستقل في DSH..."
        : publicIndependent.status === "error"
          ? "تعذر الاتصال بخدمة النشر. أعد فتح الصفحة بعد عودة الخدمة."
          : publicIndependent.status === "available"
            ? "نُشر المتجر، لكن عنوان HTTPS العام لويب العميل غير مُهيأ."
            : (__DEV__ && Platform.OS === "web"
              ? "رابط المتجر غير جاهز حتى يعتمد DSH النشر أو يُهيأ ويب العميل."
              : "رابط الموقع العام غير مُفعّل بعد. يجب اعتماد نشر المتجر المستقل في DSH، مع استكمال الشروط والسياسات والصور والمنتجات.")}
    </Text> : null}
    {!independent && store.publicationState !== "published"
      ? <Text style={styles.muted}>سيصبح رابط المتجر متاحًا بعد اعتماد النشر.</Text>
      : link ? <>
        <Text selectable accessibilityLabel={link.previewOnly ? "رابط التطوير المحلي" : "رابط المتجر العام"} style={styles.muted}>{link.url}</Text>
        {link.previewOnly ? <Text style={styles.muted}>عنوان تطوير محلي وليس رابطًا عامًا للعملاء.</Text> : null}
        <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
          <BthwaniButton label={link.previewOnly ? "فتح رابط التطوير" : "فتح المتجر"} variant="secondary" disabled={busy} onPress={() => void open()} />
          <BthwaniButton label={link.previewOnly ? "نسخ رابط التطوير" : "نسخ الرابط"} disabled={busy} onPress={() => void copy()} />
          {!link.previewOnly && Platform.OS !== "web" ? <BthwaniButton label="مشاركة المتجر" variant="secondary" disabled={busy} onPress={() => void share()} /> : null}
          {whatsAppURL ? <BthwaniButton label="مشاركة عبر واتساب" variant="secondary" disabled={busy} onPress={() => void shareViaWhatsApp()} /> : null}
        </View>
      </> : !independent && store.publicationState === "published"
        ? <Text style={styles.muted}>لم يُضبط رابط HTTPS العام لويب العميل بعد. لن نعرض رابط تطوير محليًا بوصفه رابطًا عامًا.</Text>
        : null}
    {notice ? <Text accessibilityLiveRegion="polite" style={styles.muted}>{notice}</Text> : null}
  </View>;
}
