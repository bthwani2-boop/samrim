import { collectStoreCatalogCsv, createDshMobileClient, STORE_CATALOG_EXPORT_PAGE_SIZE } from "@bthwani/dsh";
import { BthwaniButton, useAppearanceTheme } from "@bthwani/design-system/native";
import * as Crypto from "expo-crypto";
import { File, Paths } from "expo-file-system";
import * as Sharing from "expo-sharing";
import { useMemo, useRef, useState } from "react";
import { Platform, StyleSheet, Text, View } from "react-native";

import { currentIdentityState, getUsableIdentityAccessToken } from "../../bootstrap/identity";


function client() {
  const value = process.env.EXPO_PUBLIC_DSH_API_URL?.trim();
  if (!value) throw new Error("DSH_BASE_URL_REQUIRED");
  return createDshMobileClient(value, { cryptoRandomUUID: () => Crypto.randomUUID() });
}

export function StoreCatalogExportCard({ storeId, storeName }: Readonly<{ storeId: string; storeName?: string }>) {
  const theme = useAppearanceTheme();
  const styles = useMemo(() => StyleSheet.create({
    block: { backgroundColor: theme.surfaceRaised, borderColor: theme.borderColor, borderRadius: 12, borderWidth: 1, gap: 10, padding: 14, width: "100%" },
    title: { color: theme.color, fontSize: 18, fontWeight: "700" },
    muted: { color: theme.colorMuted, fontSize: 14 },
    error: { color: theme.danger, fontSize: 14 },
  }), [theme]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [progress, setProgress] = useState(0);
  const activeStoreId = useRef(storeId);
  activeStoreId.current = storeId;

  async function exportCatalog() {
    if (busy || !storeId.trim()) return;
    setBusy(true);
    setError("");
    setNotice("");
    setProgress(0);
    const actor = currentIdentityState();
    const actorId = actor.kind === "authenticated" ? actor.identity.subject.trim() : "";
    const scopeCurrent = () => {
      const active = currentIdentityState();
      return Boolean(actorId) && active.kind === "authenticated" && active.identity.subject.trim() === actorId && activeStoreId.current === storeId;
    };
    try {
      if (!scopeCurrent()) throw new Error("STORE_EXPORT_SESSION_CHANGED");
      const token = await getUsableIdentityAccessToken();
      const api = client();
      const result = await collectStoreCatalogCsv(storeId, async cursor => {
        if (!scopeCurrent()) throw new Error("STORE_EXPORT_SESSION_CHANGED");
        const page = await api.readOwnStoreOffers(token, storeId, STORE_CATALOG_EXPORT_PAGE_SIZE, cursor);
        if (!scopeCurrent()) throw new Error("STORE_EXPORT_SESSION_CHANGED");
        return page;
      }, count => { if (scopeCurrent()) setProgress(count); });
      if (!scopeCurrent()) throw new Error("STORE_EXPORT_SESSION_CHANGED");
      if (!result.count) {
        setNotice("لا توجد عروض لهذا المتجر بعد؛ لا شيء لتصديره.");
        return;
      }
      const filename = `bthwani-store-${encodeURIComponent(storeId)}-catalog.csv`;
      if (Platform.OS === "web") {
        const url = URL.createObjectURL(new Blob([result.csv], { type: "text/csv;charset=utf-8" }));
        try {
          const anchor = document.createElement("a");
          anchor.href = url;
          anchor.download = filename;
          anchor.click();
        } finally { URL.revokeObjectURL(url); }
      } else {
        if (!await Sharing.isAvailableAsync()) throw new Error("STORE_EXPORT_SHARING_UNAVAILABLE");
        if (!scopeCurrent()) throw new Error("STORE_EXPORT_SESSION_CHANGED");
        const file = new File(Paths.cache, `bthwani-store-catalog-${Crypto.randomUUID()}.csv`);
        file.create();
        file.write(result.csv);
        await Sharing.shareAsync(file.uri, { mimeType: "text/csv", dialogTitle: storeName ? `كتالوج ${storeName}` : "كتالوج المتجر" });
      }
      if (scopeCurrent()) setNotice(`تم تجهيز ملف CSV يضم ${result.count} عرضًا من بيانات المتجر المصرح بها.`);
    } catch (cause) {
      console.warn("DSH Store catalog export failed", cause);
      const code = cause instanceof Error ? cause.message : "";
      if (scopeCurrent()) setError(code === "STORE_EXPORT_TOO_LARGE_OR_INCONSISTENT" ? "الكتالوج أكبر من الحد الآمن للتصدير على الجهاز أو تغيرت صفحاته. لم يُصدر ملف ناقص؛ استخدم تصديرًا مجزأً." : code === "STORE_EXPORT_SESSION_CHANGED" ? "تغير الحساب أو المتجر. أُلغيت عملية التصدير لحماية البيانات." : "تعذر تجهيز ملف الكتالوج. تحقق من الاتصال والصلاحيات ثم أعد المحاولة.");
    } finally {
      setBusy(false);
    }
  }

  return <View accessibilityLabel="تصدير كتالوج المتجر" style={styles.block}>
    <Text style={styles.title}>تصدير الكتالوج</Text>
    <Text style={styles.muted}>تصدير ملف CSV فعلي من عروض المتجر الحالية، بما فيها الأسعار والتوافر وحالة النشر. يشمل كل الصفحات ضمن حد حماية أداء الجهاز، ولا ينتج ملفًا ناقصًا بصمت.</Text>
    {busy ? <Text accessibilityLiveRegion="polite" style={styles.muted}>جارٍ قراءة عروض المتجر: {progress}</Text> : null}
    <BthwaniButton busy={busy} disabled={busy} label="تصدير عروض المتجر" onPress={() => void exportCatalog()} variant="secondary" />
    {error ? <Text accessibilityRole="alert" style={styles.error}>{error}</Text> : null}
    {notice ? <Text accessibilityRole="text" accessibilityLiveRegion="polite" style={styles.muted}>{notice}</Text> : null}
  </View>;
}
