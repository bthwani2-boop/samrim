import { useMobileAppearance } from "@bthwani/tamagui-config/appearance";
import { CryptoDigestAlgorithm, digest } from "expo-crypto";
import { getDocumentAsync } from "expo-document-picker";
import { useLayoutEffect, useRef, useState } from "react";
import { Platform, Pressable, Text, View } from "react-native";
import MerchantCapabilityScreen from "../../components/merchant-capability-screen";
import { csvPreviewByteLimit, previewCatalogCsv, readCatalogCsv, reviewCatalogImportRows } from "./catalog-import-data";
import CatalogImportRun from "./catalog-import-run";
import { readMerchantCatalogPage } from "./catalog-transport";
import MerchantCatalogDraftForm from "./merchant-catalog-draft-form";

function CatalogImportPreview({ actorId, storeId, onChanged }: Readonly<{ actorId: string; storeId: string; onChanged?: (() => void) | undefined }>) {
  const { theme } = useMobileAppearance();
  const [rows, setRows] = useState<ReturnType<typeof previewCatalogCsv>>([]);
  const [page, setPage] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [filter, setFilter] = useState<"all" | "existing-store-name" | "owner-review" | "invalid" | "duplicate-name">("all");
  const [selected, setSelected] = useState<number | null>(null);
  const [notice, setNotice] = useState("");
  const [sourceSha256,setSourceSha256]=useState("");
  const [reviewController, setReviewController] = useState<AbortController | null>(null);
  const active = useRef<AbortController | null>(null);
  useLayoutEffect(() => () => { active.current?.abort(); active.current = null; }, []);

  function cancelReview() {
    if (!reviewController || active.current !== reviewController) return;
    active.current = null;
    reviewController.abort();
    setReviewController(null);
    setBusy(false);
    setNotice("أُلغيت مراجعة الملف. يمكنك إعادة المحاولة.");
  }

  async function choose() {
    if (active.current || selected !== null) return;
    const controller = new AbortController();
    active.current = controller;
    const { signal } = controller;
    setBusy(true);
    setError("");
    setNotice("");
    setRows([]);
    setSourceSha256("");
    setPage(0);
    setFilter("all");
    let webUri: string | undefined;
    let timeout: ReturnType<typeof setTimeout> | undefined;
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
      setReviewController(controller);
      timeout = setTimeout(() => controller.abort(), 120000);
      // Verify the current Store grant before accessing any selected file content.
      await readMerchantCatalogPage(storeId, actorId, signal, { limit: 1 });
      signal.throwIfAborted();
      const file = Platform.OS === "web" ? asset.file : new (await import("expo-file-system")).File(asset.uri);
      signal.throwIfAborted();
      if (!file) throw new Error("CSV_FORMAT");
      const {source,bytes} = await readCatalogCsv(file, signal);
      signal.throwIfAborted();
      const sourceDigest = Array.from(new Uint8Array(await digest(CryptoDigestAlgorithm.SHA256, bytes)),b=>b.toString(16).padStart(2,"0")).join("");
      signal.throwIfAborted();
      const reviewed = await reviewCatalogImportRows(previewCatalogCsv(source), actorId, storeId, signal, readMerchantCatalogPage);
      signal.throwIfAborted();
      setSourceSha256(sourceDigest);
      setRows(reviewed);
    } catch (cause) {
      if (active.current !== controller) return;
      if (signal.aborted) { setError("انتهت مهلة فحص الكتالوج؛ لم تُعرض نتائج جزئية. أعد المحاولة."); return; }
      const code = cause instanceof Error ? cause.message : "";
      setError(code === "CSV_LIMIT" ? "يتجاوز الملف حد المعاينة المحلية: 8 ميغابايت أو 5000 سجل، أو تعذّر التحقق من حجمه."
        : code === "CATALOG_EXPORT_LIMIT" ? "تعذّرت مطابقة جميع عروض المتجر ضمن حد القراءة؛ لم تُعرض نتائج جزئية."
        : code.startsWith("CSV_") ? "ملف CSV غير صالح. استخدم الأعمدة المحددة بترميز UTF-8."
        : "تعذّرت قراءة الملف أو التحقق من صلاحية المتجر لدى DSH.");
    } finally {
      if (timeout !== undefined) clearTimeout(timeout);
      if (webUri) URL.revokeObjectURL(webUri);
      if (active.current === controller) {
        active.current = null;
        setReviewController(null);
        setBusy(false);
      }
    }
  }

  const held = rows.filter(row => row.reason === "owner-review").length;
  const existing = rows.filter(row => row.reason === "existing-store-name").length;
  const visible = filter === "all" ? rows : rows.filter(row => row.reason === filter);
  const filters = [
    ["all", "عرض الكل"], ["existing-store-name", "عرض تعارضات المتجر"],
    ["owner-review", "عرض ما يحتاج مراجعة"], ["invalid", "عرض السجلات غير الصالحة"],
    ["duplicate-name", "عرض المكرر في الملف"],
  ] as const;
  const button = { minHeight: 44, justifyContent: "center" as const, borderColor: theme.borderColor,
    borderWidth: 1, borderRadius: 10, paddingHorizontal: 14, paddingVertical: 10 };
  return <View style={{ gap: 8 }}>
    <Text style={{ color: theme.color, fontWeight: "700" }}>فحص ملف المنتجات قبل الاستيراد</Text>
    <Text style={{ color: theme.colorSecondary }}>
      اختر CSV بترميز UTF-8 وعناوين الأعمدة name,price_yer,stock_units بهذا الترتيب.
      تُطابق الأسماء مع عروض المتجر المقروءة من DSH؛ عدم العثور على اسم لا يثبت أهلية إنشاء منتج جديد.
      المعاينة محلية؛ عند اعتماد الدفعة تُرسل بيانات الصفوف إلى DSH، ولا يُنشأ أي منتج. يمكنك مراجعة سعر ومخزون مسودة مطابقة واحدة وحفظ تعديلها لدى DSH بشكل صريح؛ تبقى المسودات غير منشورة. يمكن اعتماد دفعة لتعديل المسودات المطابقة فقط؛ إنشاء المنتجات الجماعي وحل الهويات الملتبسة غير متاحين بعد.
    </Text>
    <Pressable accessibilityRole="button" accessibilityLabel="معاينة ملف المنتجات CSV"
      accessibilityState={{ busy, disabled: busy || selected !== null }} disabled={busy || selected !== null} onPress={() => void choose()} style={button}>
      <Text style={{ color: theme.interactiveText }}>{busy ? "جارٍ فحص الملف…" : "اختيار ملف CSV وفحصه"}</Text>
    </Pressable>
    {reviewController ? <Pressable accessibilityRole="button" accessibilityLabel="إلغاء مراجعة الملف"
      onPress={cancelReview} style={button}>
      <Text style={{ color: theme.interactiveText }}>إلغاء مراجعة الملف</Text>
    </Pressable> : null}
    {error ? <Text accessibilityRole="alert" style={{ color: theme.warningText }}>{error}</Text> : null}
    {notice ? <Text accessibilityLiveRegion="polite" style={{ color: theme.successText }}>{notice}</Text> : null}
    <CatalogImportRun key={JSON.stringify([actorId,storeId])} actorId={actorId} storeId={storeId}
      rows={selected!==null||busy?[]:rows} sourceSha256={sourceSha256}
      onChanged={() => { setRows([]); setSourceSha256(""); setPage(0); setFilter("all"); onChanged?.(); }} />
    {selected !== null ? (() => {
      const row = rows.find(r => r.row === selected);
      if (!row?.editableDraft) return null;
      return <View style={{ gap: 8 }}>
        <Text style={{ color: theme.color }}>السجل {row.row} · مراجعة العرض {row.editableDraft.id}</Text>
        <Text style={{ color: theme.colorSecondary }}>الاسم ومعرّف العرض ثابتان؛ راجع القيم قبل الحفظ. يتحقق DSH من صلاحيتك ونسخة المسودة.</Text>
        <MerchantCatalogDraftForm key={JSON.stringify([actorId, storeId, row.editableDraft.id, row.editableDraft.draftVersion])}
          actorId={actorId} storeId={storeId} draft={row.editableDraft} priceStockOnly
          initialPriceStock={{ priceYer: row.priceYer, stockUnits: Number(row.stockUnits) }}
          onSaved={() => { setNotice("أكد DSH حفظ تعديل المسودة غير المنشورة. افحص الملف مجددًا لقراءة أحدث بيانات المتجر."); onChanged?.(); }}
          onCreated={() => { setSelected(null); setRows([]); setPage(0); setFilter("all"); }} />
        <Pressable accessibilityRole="button" onPress={() => setSelected(null)} style={button}>
          <Text style={{ color: theme.interactiveText }}>العودة إلى المعاينة</Text>
        </Pressable>
      </View>;
    })() : rows.length > 0 ? <>
      <Text accessibilityLiveRegion="polite" style={{ color: theme.color }}>
        {rows.length} سجل · {held} يحتاج مراجعة DSH · {existing} اسم موجود في المتجر · {rows.length-held-existing} غير صالح أو مكرر · المعاينة لا تحفظ أي سجل.
      </Text>
      <View style={{ flexDirection: "row", gap: 8, flexWrap: "wrap" }}>
        {filters.map(([value, label]) => <Pressable key={value} accessibilityRole="button"
          accessibilityLabel={label} accessibilityState={{ selected: filter === value }}
          onPress={() => { setFilter(value); setPage(0); }} style={{ ...button, borderWidth: filter === value ? 2 : 1 }}>
          <Text style={{ color: theme.interactiveText }}>{label}</Text>
        </Pressable>)}
      </View>
      {visible.length === 0 ? <Text accessibilityLiveRegion="polite" style={{ color: theme.colorSecondary }}>لا توجد سجلات مطابقة</Text> : null}
      {visible.slice(page*25, (page+1)*25).map(row => <View key={row.row} style={{ gap: 4, padding: 8 }}>
        <Text style={{ color: theme.color }}>السجل {row.row} · {row.reason === "invalid" ? "بيانات غير صالحة" :
          row.reason === "duplicate-name" ? "اسم مكرر في الملف" : row.reason === "existing-store-name" ?
            "اسم موجود في كتالوج المتجر — يحتاج تسوية التعارض" : "يحتاج مراجعة DSH"}</Text>
        {row.reason !== "invalid" ? <Text style={{ color: theme.colorSecondary }}>
          {row.name} · {row.priceYer} ريال يمني · المخزون {row.stockUnits}
        </Text> : null}
        {row.match ? <Text style={{ color: theme.warningText }}>
          {row.match.count === 1 ? `العرض الحالي: ${row.match.priceYer} ريال يمني · المخزون ${row.match.stockUnits} · ${row.match.published ? "منشور" : "غير منشور"}` :
            `توجد ${row.match.count} عروض بالاسم نفسه؛ لم يُحدد أي عرض تلقائيًا.`}
        </Text> : null}
        {row.editableDraft ? <Pressable accessibilityRole="button" accessibilityLabel={`مراجعة تعديل المسودة للسجل ${row.row}`}
          onPress={() => setSelected(row.row)} style={button}>
          <Text style={{ color: theme.interactiveText }}>مراجعة تعديل المسودة الحالية</Text>
        </Pressable> : null}
      </View>)}
      <View style={{ flexDirection: "row", gap: 8, flexWrap: "wrap" }}>
        <Pressable accessibilityRole="button" disabled={page === 0}
          accessibilityState={{ disabled: page === 0 }} onPress={() => setPage(p => Math.max(0, p-1))} style={button}>
          <Text style={{ color: theme.interactiveText }}>السابق</Text>
        </Pressable>
        <Pressable accessibilityRole="button" disabled={(page+1)*25 >= visible.length}
          accessibilityState={{ disabled: (page+1)*25 >= visible.length }}
          onPress={() => setPage(p => Math.min(Math.max(0, Math.ceil(visible.length/25)-1), p+1))} style={button}>
          <Text style={{ color: theme.interactiveText }}>التالي</Text>
        </Pressable>
        <Pressable accessibilityRole="button" onPress={() => { setRows([]); setSourceSha256(""); setPage(0); setFilter("all"); }} style={button}>
          <Text style={{ color: theme.interactiveText }}>مسح المعاينة</Text>
        </Pressable>
      </View>
    </> : null}
  </View>;
}

export default function CatalogImport({ actorId, storeId, onChanged }: Readonly<{ actorId?: string; storeId?: string; onChanged?: (() => void) | undefined }> = {}) {
  if (!actorId || !storeId) return <MerchantCapabilityScreen title="استيراد الكتالوج"
    message="افتح الكتالوج من مساحة التاجر الموثقة وحدد متجرك لفحص الملف." />;
  return <CatalogImportPreview key={JSON.stringify([actorId, storeId])} actorId={actorId} storeId={storeId} onChanged={onChanged} />;
}
