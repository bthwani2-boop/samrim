import { BthwaniButton, useAppearanceTheme } from "@bthwani/design-system/native";
import { collectStoreCatalogCsv, STORE_CATALOG_EXPORT_PAGE_SIZE } from "@bthwani/dsh";
import * as Crypto from "expo-crypto";
import { File, Paths } from "expo-file-system";
import * as Sharing from "expo-sharing";
import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { Platform, StyleSheet, Text, View } from "react-native";
import { createPartnerDshClient } from "../../bootstrap/dsh-client";

import { currentIdentityState, getUsableIdentityAccessToken, subscribeIdentitySession } from "../../bootstrap/identity";
import { partnerSetupSessionKey } from "../partner-onboarding/partner-setup-session-scope";

const currentPartnerSessionKey = () => partnerSetupSessionKey(currentIdentityState());

const client = createPartnerDshClient;

export function StoreCatalogExportCard({ storeId, storeName }: Readonly<{ storeId: string; storeName?: string }>) {
  const theme = useAppearanceTheme();
  const styles = useMemo(() => StyleSheet.create({
    block: { backgroundColor: theme.surfaceRaised, borderColor: theme.borderColor, borderRadius: 12, borderWidth: 1, gap: 10, padding: 14, width: "100%" },
    title: { color: theme.color, fontSize: 18, fontWeight: "700" },
    muted: { color: theme.colorMuted, fontSize: 14 },
    error: { color: theme.danger, fontSize: 14 },
  }), [theme]);
  const sessionKey = useSyncExternalStore(subscribeIdentitySession, currentPartnerSessionKey, () => "");
  const scopeKey = JSON.stringify([sessionKey, storeId]);
  const [busy, setBusy] = useState(false);
  const [feedbackScope, setFeedbackScope] = useState("");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [progress, setProgress] = useState(0);
  const activeStoreId = useRef(storeId);
  const activeRun = useRef(0);
  activeStoreId.current = storeId;
  useEffect(() => {
    // A Store or Identity-session change cancels an export from the previous scope.
    void scopeKey;
    return () => { activeRun.current += 1; };
  }, [scopeKey]);
  const statusCurrent = Boolean(sessionKey) && currentPartnerSessionKey() === sessionKey && feedbackScope === scopeKey;
  const visibleBusy = statusCurrent && busy;

  async function exportCatalog() {
    if (visibleBusy || !storeId.trim() || !sessionKey || currentPartnerSessionKey() !== sessionKey) return;
    const run = ++activeRun.current;
    setFeedbackScope(scopeKey);
    setBusy(true);
    setError("");
    setNotice("");
    setProgress(0);
    const scopeCurrent = () => activeRun.current === run && currentPartnerSessionKey() === sessionKey && activeStoreId.current === storeId;
    try {
      if (!scopeCurrent()) throw new Error("STORE_EXPORT_SESSION_CHANGED");
      const token = await getUsableIdentityAccessToken();
      if (!scopeCurrent()) throw new Error("STORE_EXPORT_SESSION_CHANGED");
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
      if (activeRun.current === run) setBusy(false);
    }
  }

  return <View accessibilityLabel="تصدير كتالوج المتجر" style={styles.block}>
    <Text style={styles.title}>تصدير الكتالوج</Text>
    <Text style={styles.muted}>تصدير ملف CSV فعلي من عروض المتجر الحالية، بما فيها الأسعار والتوافر وحالة النشر. يشمل كل الصفحات ضمن حد حماية أداء الجهاز، ولا ينتج ملفًا ناقصًا بصمت.</Text>
    {visibleBusy ? <Text accessibilityLiveRegion="polite" style={styles.muted}>جارٍ قراءة عروض المتجر: {progress}</Text> : null}
    <BthwaniButton busy={visibleBusy} disabled={visibleBusy || !sessionKey} label="تصدير عروض المتجر" onPress={() => void exportCatalog()} variant="secondary" />
    {statusCurrent && error ? <Text accessibilityRole="alert" style={styles.error}>{error}</Text> : null}
    {statusCurrent && notice ? <Text accessibilityRole="text" accessibilityLiveRegion="polite" style={styles.muted}>{notice}</Text> : null}
  </View>;
}
