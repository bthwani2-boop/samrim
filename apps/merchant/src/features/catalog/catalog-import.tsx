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

type Interaction = "review" | "run" | "draft";
type Lease = { isCurrent: () => boolean; release: () => void };
type ReviewAttempt = { controller: AbortController; lease: Lease };
type PreviewRow = ReturnType<typeof previewCatalogCsv>[number];
type DraftSelection = { row: PreviewRow; lease: Lease };

function CatalogImportPreview({ actorId, storeId, onChanged }: Readonly<{ actorId: string; storeId: string; onChanged?: (() => void) | undefined }>) {
  const { theme } = useMobileAppearance();
  const [rows, setRows] = useState<ReturnType<typeof previewCatalogCsv>>([]);
  const [page, setPage] = useState(0);
  const [activity, setActivity] = useState<Interaction | null>(null);
  const [error, setError] = useState("");
  const [filter, setFilter] = useState<"all" | "existing-store-name" | "owner-review" | "invalid" | "duplicate-name">("all");
  const [selected, setSelected] = useState<DraftSelection | null>(null);
  const [notice, setNotice] = useState("");
  const [sourceSha256,setSourceSha256]=useState("");
  const [reviewController, setReviewController] = useState<AbortController | null>(null);
  const reviewedRows = useRef<readonly PreviewRow[]>([]);
  const active = useRef<ReviewAttempt | null>(null);
  const interaction = useRef<Lease | null>(null);
  const mounted = useRef(false);
  const busy = activity === "review";
  useLayoutEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      interaction.current = null;
      active.current?.controller.abort();
      active.current = null;
    };
  }, []);

  // One synchronous admission owner for the three competing interactions.
  // React state projects that owner for rendering; stale callbacks cannot
  // acquire or release another operation's lease.
  function begin(kind: Interaction): Lease | null {
    if (!mounted.current || interaction.current !== null) return null;
    const lease: Lease = {
      isCurrent: () => mounted.current && interaction.current === lease,
      release: () => {
        if (!lease.isCurrent()) return;
        interaction.current = null;
        setActivity(null);
      },
    };
    interaction.current = lease;
    setActivity(kind);
    return lease;
  }

  function clearPreview() {
    reviewedRows.current = [];
    setRows([]);
    setSourceSha256("");
    setPage(0);
    setFilter("all");
  }

  function cancelReview() {
    const attempt = active.current;
    if (!reviewController || attempt?.controller !== reviewController || !attempt.lease.isCurrent()) return;
    active.current = null;
    attempt.controller.abort();
    setReviewController(null);
    attempt.lease.release();
    setNotice("أُلغيت مراجعة الملف. يمكنك إعادة المحاولة.");
  }

  function openDraft(row: PreviewRow) {
    if (!row.editableDraft || !reviewedRows.current.includes(row)) return;
    const lease = begin("draft");
    if (lease) setSelected({ row, lease });
  }

  function closeDraft(selection: DraftSelection, changed = false) {
    if (!selection.lease.isCurrent()) return;
    setSelected(null);
    if (changed) clearPreview();
    selection.lease.release();
  }

  async function choose() {
    const lease = begin("review");
    if (!lease) return;
    const controller = new AbortController();
    const attempt = { controller, lease };
    active.current = attempt;
    const { signal } = controller;
    setError("");
    setNotice("");
    clearPreview();
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
      reviewedRows.current = reviewed;
      setSourceSha256(sourceDigest);
      setRows(reviewed);
    } catch (cause) {
      if (active.current !== attempt || !lease.isCurrent()) return;
      if (signal.aborted) { setError("انتهت مهلة فحص الكتالوج؛ لم تُعرض نتائج جزئية. أعد المحاولة."); return; }
      const code = cause instanceof Error ? cause.message : "";
      setError(code === "CSV_LIMIT" ? "يتجاوز الملف حد المعاينة المحلية: 8 ميغابايت أو 5000 سجل، أو تعذّر التحقق من حجمه."
        : code === "CATALOG_EXPORT_LIMIT" ? "تعذّرت مطابقة جميع عروض المتجر ضمن حد القراءة؛ لم تُعرض نتائج جزئية."
        : code.startsWith("CSV_") ? "ملف CSV غير صالح. استخدم الأعمدة المحددة بترميز UTF-8."
        : "تعذّرت قراءة الملف أو التحقق من صلاحية المتجر لدى DSH.");
    } finally {
      if (timeout !== undefined) clearTimeout(timeout);
      try {
        if (webUri) URL.revokeObjectURL(webUri);
      } finally {
        if (active.current === attempt && lease.isCurrent()) {
          active.current = null;
          setReviewController(null);
          lease.release();
        }
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
      accessibilityState={{ busy, disabled: activity !== null }} disabled={activity !== null} onPress={() => void choose()} style={button}>
      <Text style={{ color: theme.interactiveText }}>{busy ? "جارٍ فحص الملف…" : "اختيار ملف CSV وفحصه"}</Text>
    </Pressable>
    {reviewController ? <Pressable accessibilityRole="button" accessibilityLabel="إلغاء مراجعة الملف"
      onPress={cancelReview} style={button}>
      <Text style={{ color: theme.interactiveText }}>إلغاء مراجعة الملف</Text>
    </Pressable> : null}
    {error ? <Text accessibilityRole="alert" style={{ color: theme.warningText }}>{error}</Text> : null}
    {notice ? <Text accessibilityLiveRegion="polite" style={{ color: theme.successText }}>{notice}</Text> : null}
    <CatalogImportRun key={JSON.stringify([actorId,storeId])} actorId={actorId} storeId={storeId}
      rows={rows} sourceSha256={sourceSha256}
      blocked={activity === "review" || activity === "draft"} running={activity === "run"}
      beginRun={() => begin("run")?.release ?? null}
      onChanged={() => { clearPreview(); onChanged?.(); }} />
    {selected !== null ? (() => {
      const row = selected.row;
      if (!row?.editableDraft) return null;
      return <View style={{ gap: 8 }}>
        <Text style={{ color: theme.color }}>السجل {row.row} · مراجعة العرض {row.editableDraft.id}</Text>
        <Text style={{ color: theme.colorSecondary }}>الاسم ومعرّف العرض ثابتان؛ راجع القيم قبل الحفظ. يتحقق DSH من صلاحيتك ونسخة المسودة.</Text>
        <MerchantCatalogDraftForm key={JSON.stringify([actorId, storeId, row.editableDraft.id, row.editableDraft.draftVersion])}
          actorId={actorId} storeId={storeId} draft={row.editableDraft} priceStockOnly
          initialPriceStock={{ priceYer: row.priceYer, stockUnits: Number(row.stockUnits) }}
          onSaved={() => { if (selected.lease.isCurrent()) { setNotice("أكد DSH حفظ تعديل المسودة غير المنشورة. افحص الملف مجددًا لقراءة أحدث بيانات المتجر."); onChanged?.(); } }}
          onCreated={() => closeDraft(selected, true)} />
        <Pressable accessibilityRole="button" onPress={() => closeDraft(selected)} style={button}>
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
          disabled={activity !== null} accessibilityState={{ disabled: activity !== null }} onPress={() => openDraft(row)} style={button}>
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
        <Pressable accessibilityRole="button" disabled={activity !== null} accessibilityState={{ disabled: activity !== null }} onPress={() => { if (!interaction.current && mounted.current && reviewedRows.current === rows) clearPreview(); }} style={button}>
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
