import { createDshMobileClient, type CatalogStoreOffer } from "@bthwani/dsh";
import { BthwaniButton, useAppearanceTheme } from "@bthwani/design-system/native";
import * as Crypto from "expo-crypto";
import { useMemo, useState } from "react";
import { Share, StyleSheet, Text, View } from "react-native";

import { getUsableIdentityAccessToken } from "../../bootstrap/identity";

const EXPORT_ROW_LIMIT = 2000;
const EXPORT_PAGE_SIZE = 50;

function client() {
  const value = process.env.EXPO_PUBLIC_DSH_API_URL?.trim();
  if (!value) throw new Error("DSH_BASE_URL_REQUIRED");
  return createDshMobileClient(value, { cryptoRandomUUID: () => Crypto.randomUUID() });
}

function csvCell(value: string): string {
  if (/[",\n\r]/.test(value)) return `"${value.replace(/"/g, '""')}"`;
  return value;
}

function composeOffersCsv(offers: ReadonlyArray<CatalogStoreOffer>): string {
  const header = ["اسم المنتج", "النسخة", "العلامة التجارية", "السعر بالريال", "التوافر", "حالة النشر", "هوية القياس", "الوحدة الأساسية"].map(csvCell).join(",");
  const rows = offers.map((offer) => [
    offer.productName,
    offer.variantTitle,
    offer.brand ?? "",
    String(offer.priceMinor),
    offer.availability ? "متاح" : "غير متاح",
    offer.publicationState === "published" ? "منشور" : offer.publicationState === "hidden" ? "مخفي" : "مسودة",
    offer.measurementKind === "DISCRETE" ? "عدد" : offer.measurementKind === "MEASURED" ? "قياس" : "كمية متغيرة",
    offer.baseUnit,
  ].map(csvCell).join(","));
  return `\uFEFF${[header, ...rows].join("\r\n")}`;
}

export function StoreCatalogExportCard({ storeId, storeName }: { storeId: string; storeName?: string }) {
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

  async function exportCatalog() {
    if (busy || !storeId.trim()) return;
    setBusy(true);
    setError("");
    setNotice("");
    try {
      const token = await getUsableIdentityAccessToken();
      const offers: CatalogStoreOffer[] = [];
      let cursor = "";
      for (let page = 0; page < EXPORT_ROW_LIMIT / EXPORT_PAGE_SIZE; page += 1) {
        const result = await client().readOwnStoreOffers(token, storeId, EXPORT_PAGE_SIZE, cursor);
        offers.push(...result.offers);
        cursor = result.nextCursor ?? "";
        if (!cursor) break;
      }
      if (!offers.length) {
        setNotice("لا توجد عروض لهذا المتجر بعد؛ لا شيء لتصديره.");
        return;
      }
      const csv = composeOffersCsv(offers);
      const shareResult = await Share.share({ message: csv, title: storeName ? `كتالوج ${storeName}` : "كتالوج المتجر" }, { dialogTitle: "تصدير كتالوج المتجر" });
      if (shareResult.action === Share.sharedAction) setNotice(`تم تجهيز ${offers.length} عرضًا للتصدير مع بيانات الأسعار والتوافر والنشر.`);
    } catch (cause) {
      console.warn("DSH Store catalog export failed", cause);
      setError("تعذر تصدير الكتالوج. أعد المحاولة بعد التحقق من الاتصال.");
    } finally {
      setBusy(false);
    }
  }

  return <View accessibilityLabel="تصدير كتالوج المتجر" style={styles.block}>
    <Text style={styles.title}>تصدير الكتالوج</Text>
    <Text style={styles.muted}>يجهّز النظام ملفًا نصيًا (CSV) من عروض متجرك الحالية بأسعارها وتوافرها وحالة نشرها، حتى {EXPORT_ROW_LIMIT} عرضًا، ويفتح قائمة المشاركة لحفظه أو إرساله.</Text>
    <BthwaniButton busy={busy} disabled={busy} label="تصدير عروض المتجر" onPress={() => void exportCatalog()} variant="secondary" />
    {error ? <Text accessibilityRole="alert" style={styles.error}>{error}</Text> : null}
    {notice ? <Text accessibilityRole="text" accessibilityLiveRegion="polite" style={styles.muted}>{notice}</Text> : null}
  </View>;
}
