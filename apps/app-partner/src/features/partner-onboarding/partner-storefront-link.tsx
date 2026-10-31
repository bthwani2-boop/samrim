import { BthwaniButton, useAppearanceTheme } from "@bthwani/design-system/native";
import type { PartnerAccessibleStore } from "@bthwani/dsh";
import * as Clipboard from "expo-clipboard";
import { useMemo, useState } from "react";
import { Linking, Platform, Share, Text, View } from "react-native";

import { createPartnerSurfaceStyles } from "./partner-surface-styles";
import { buildPartnerStorefrontURL } from "./partner-storefront-url";

export function PartnerStorefrontLink({ store }: Readonly<{ store: PartnerAccessibleStore }>) {
  const theme = useAppearanceTheme();
  const styles = useMemo(() => createPartnerSurfaceStyles(theme), [theme]);
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);
  const link = buildPartnerStorefrontURL(store, process.env.EXPO_PUBLIC_CLIENT_WEB_ORIGIN, __DEV__);

  async function copy() {
    if (!link || busy) return;
    setBusy(true); setNotice("");
    try {
      await Clipboard.setStringAsync(link.url);
      setNotice(link.previewOnly ? "تم نسخ رابط المعاينة المحلية." : "تم نسخ رابط المتجر.");
    } catch { setNotice("تعذر نسخ الرابط. أعد المحاولة."); }
    finally { setBusy(false); }
  }
  async function open() {
    if (!link || busy) return;
    try { await Linking.openURL(link.url); }
    catch { setNotice("تعذر فتح الرابط. تحقق من الاتصال ثم أعد المحاولة."); }
  }
  async function share() {
    if (!link || link.previewOnly || busy) return;
    try { await Share.share({ title: store.name, message: `${store.name}\n${link.url}` }); }
    catch { setNotice("تعذرت المشاركة. يمكنك نسخ الرابط بدلاً منها."); }
  }

  return <View style={styles.card}>
    <Text style={styles.value}>رابط متجر {store.name}</Text>
    {store.publicationState !== "published"
      ? <Text style={styles.muted}>سيصبح رابط المتجر متاحًا بعد اعتماد النشر.</Text>
      : link ? <>
        <Text selectable accessibilityLabel={link.previewOnly ? "رابط المعاينة المحلية" : "رابط المتجر العام"} style={styles.muted}>{link.url}</Text>
        {link.previewOnly ? <Text style={styles.muted}>معاينة محلية على جهاز التطوير أو هاتف موصول به؛ ليست رابطًا عامًا للعملاء.</Text> : null}
        <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
          <BthwaniButton label={link.previewOnly ? "فتح المعاينة" : "فتح المتجر"} variant="secondary" disabled={busy} onPress={() => void open()} />
          <BthwaniButton label={link.previewOnly ? "نسخ رابط المعاينة" : "نسخ الرابط"} disabled={busy} onPress={() => void copy()} />
          {!link.previewOnly && Platform.OS !== "web" ? <BthwaniButton label="مشاركة المتجر" variant="secondary" disabled={busy} onPress={() => void share()} /> : null}
        </View>
      </> : <Text style={styles.muted}>لم يُضبط رابط HTTPS العام لويب العميل بعد. لن نعرض رابط تطوير محليًا بوصفه رابطًا عامًا.</Text>}
    {notice ? <Text accessibilityLiveRegion="polite" style={styles.muted}>{notice}</Text> : null}
  </View>;
}
