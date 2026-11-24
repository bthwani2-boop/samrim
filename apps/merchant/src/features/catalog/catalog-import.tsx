import { useMobileAppearance } from "@bthwani/tamagui-config/appearance";
import { getDocumentAsync } from "expo-document-picker";
import { useLayoutEffect, useRef, useState } from "react";
import { Platform, Pressable, Text, View } from "react-native";
import MerchantCapabilityScreen from "../../components/merchant-capability-screen";
import { csvPreviewByteLimit, previewCatalogCsv, readCatalogCsv } from "./catalog-import-data";
import { readMerchantCatalogPage } from "./catalog-transport";

function CatalogImportPreview({ actorId, storeId }: Readonly<{ actorId: string; storeId: string }>) {
  const { theme } = useMobileAppearance();
  const [rows, setRows] = useState<ReturnType<typeof previewCatalogCsv>>([]);
  const [page, setPage] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const active = useRef<AbortController | null>(null);
  useLayoutEffect(() => () => { active.current?.abort(); active.current = null; }, []);

  async function choose() {
    if (active.current) return;
    const controller = new AbortController();
    active.current = controller;
    const { signal } = controller;
    setBusy(true);
    setError("");
    setRows([]);
    setPage(0);
    let webUri: string | undefined;
    try {
      // Start the picker directly from the user gesture (required by Web).
      // No native cache copy or upload: only the chosen document is read.
      const picked = await getDocumentAsync({
        type: ["text/csv", "text/comma-separated-values", "application/vnd.ms-excel"],
        multiple: false, base64: false, copyToCacheDirectory: false,
      });
      if (picked.canceled) return;
      const asset = picked.assets[0];
      if (Platform.OS === "web" && asset?.uri.startsWith("blob:")) webUri = asset.uri;
      signal.throwIfAborted();
      if (!asset || picked.assets.length !== 1 || !/\.csv$/i.test(asset.name)) throw new Error("CSV_FORMAT");
      if (asset.size !== undefined && asset.size > csvPreviewByteLimit) throw new Error("CSV_LIMIT");
      // Verify the current Store grant before accessing any selected file content.
      await readMerchantCatalogPage(storeId, actorId, signal, { limit: 1 });
      signal.throwIfAborted();
      const file = Platform.OS === "web" ? asset.file : new (await import("expo-file-system")).File(asset.uri);
      signal.throwIfAborted();
      if (!file) throw new Error("CSV_FORMAT");
      const source = await readCatalogCsv(file, signal);
      signal.throwIfAborted();
      setRows(previewCatalogCsv(source));
    } catch (cause) {
      if (signal.aborted || active.current !== controller) return;
      const code = cause instanceof Error ? cause.message : "";
      setError(code === "CSV_LIMIT" ? "يتجاوز الملف حد المعاينة المحلية: 8 ميغابايت أو 5000 سجل، أو تعذّر التحقق من حجمه."
        : code.startsWith("CSV_") ? "ملف CSV غير صالح. استخدم الأعمدة المحددة بترميز UTF-8."
        : "تعذّرت قراءة الملف أو التحقق من صلاحية المتجر لدى DSH.");
    } finally {
      if (webUri) URL.revokeObjectURL(webUri);
      if (active.current === controller) { active.current = null; setBusy(false); }
    }
  }

  const held = rows.filter(row => row.reason === "owner-review").length;
  const button = { minHeight: 44, justifyContent: "center" as const, borderColor: theme.borderColor,
    borderWidth: 1, borderRadius: 10, paddingHorizontal: 14, paddingVertical: 10 };
  return <View style={{ gap: 8 }}>
    <Text style={{ color: theme.color, fontWeight: "700" }}>فحص ملف المنتجات قبل الاستيراد</Text>
    <Text style={{ color: theme.colorSecondary }}>
      اختر CSV بترميز UTF-8 وعناوين الأعمدة name,price_yer,stock_units بهذا الترتيب.
      هذه معاينة محلية فقط. لا تُرفع البيانات ولا يُنشأ أي منتج؛ الاعتماد بعد مراجعة DSH غير متاح بعد.
    </Text>
    <Pressable accessibilityRole="button" accessibilityLabel="معاينة ملف المنتجات CSV"
      accessibilityState={{ busy, disabled: busy }} disabled={busy} onPress={() => void choose()} style={button}>
      <Text style={{ color: theme.interactiveText }}>{busy ? "جارٍ فحص الملف…" : "اختيار ملف CSV وفحصه"}</Text>
    </Pressable>
    {error ? <Text accessibilityRole="alert" style={{ color: theme.warningText }}>{error}</Text> : null}
    {rows.length > 0 ? <>
      <Text accessibilityLiveRegion="polite" style={{ color: theme.color }}>
        {rows.length} سجل · {held} يحتاج مراجعة DSH · {rows.length-held} غير صالح أو مكرر · لم يُحفظ أي سجل.
      </Text>
      {rows.slice(page*25, (page+1)*25).map(row => <View key={row.row} style={{ gap: 4, padding: 8 }}>
        <Text style={{ color: theme.color }}>السجل {row.row} · {row.reason === "invalid" ? "بيانات غير صالحة" :
          row.reason === "duplicate-name" ? "اسم مكرر في الملف" : "يحتاج مراجعة DSH"}</Text>
        {row.reason !== "invalid" ? <Text style={{ color: theme.colorSecondary }}>
          {row.name} · {row.priceYer} ريال يمني · المخزون {row.stockUnits}
        </Text> : null}
      </View>)}
      <View style={{ flexDirection: "row", gap: 8, flexWrap: "wrap" }}>
        <Pressable accessibilityRole="button" disabled={page === 0}
          accessibilityState={{ disabled: page === 0 }} onPress={() => setPage(p => Math.max(0, p-1))} style={button}>
          <Text style={{ color: theme.interactiveText }}>السابق</Text>
        </Pressable>
        <Pressable accessibilityRole="button" disabled={(page+1)*25 >= rows.length}
          accessibilityState={{ disabled: (page+1)*25 >= rows.length }}
          onPress={() => setPage(p => Math.min(Math.ceil(rows.length/25)-1, p+1))} style={button}>
          <Text style={{ color: theme.interactiveText }}>التالي</Text>
        </Pressable>
        <Pressable accessibilityRole="button" onPress={() => { setRows([]); setPage(0); }} style={button}>
          <Text style={{ color: theme.interactiveText }}>مسح المعاينة</Text>
        </Pressable>
      </View>
    </> : null}
  </View>;
}

export default function CatalogImport({ actorId, storeId }: Readonly<{ actorId?: string; storeId?: string }> = {}) {
  if (!actorId || !storeId) return <MerchantCapabilityScreen title="استيراد الكتالوج"
    message="افتح الكتالوج من مساحة التاجر الموثقة وحدد متجرك لفحص الملف." />;
  return <CatalogImportPreview key={JSON.stringify([actorId, storeId])} actorId={actorId} storeId={storeId} />;
}
