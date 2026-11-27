import type { MerchantCatalogStatus } from "@bthwani/dsh";
import { useMobileAppearance } from "@bthwani/tamagui-config/appearance";
import { randomUUID } from "expo-crypto";
import { useLayoutEffect, useRef, useState } from "react";
import { Platform, Pressable, Text, View } from "react-native";
import MerchantCapabilityScreen from "../../components/merchant-capability-screen";
import { collectCatalogExport } from "./catalog-export-data";
import { readMerchantCatalogPage } from "./catalog-transport";

type ExportMode = "full" | "filtered" | "draft-edit";
type ExportPhase = "idle" | "collecting" | "delivering";
type ExportAttempt = { controller: AbortController; phase: "collecting" | "delivering" };
type ExportScope = Readonly<{
  actorId: string; storeId: string; query?: string | undefined; status?: MerchantCatalogStatus | undefined;
}>;

async function deliverCsv(csv: string, signal: AbortSignal): Promise<void> {
  signal.throwIfAborted();
  const filename = `bthwani-catalog-${randomUUID()}.csv`;
  if (Platform.OS === "web") {
    // Acquire the DOM element before allocating a browser-managed object URL.
    const link = document.createElement("a");
    const url = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }));
    try {
      link.href = url;
      link.download = filename;
      document.body.appendChild(link);
      signal.throwIfAborted();
      link.click();
    } finally {
      // A failed DOM removal must not prevent release of the URL.
      try {
        link.remove();
      } finally {
        setTimeout(() => URL.revokeObjectURL(url), 1000);
      }
    }
    return;
  }

  const [fs, sharing] = await Promise.all([import("expo-file-system"), import("expo-sharing")]);
  if (!await sharing.isAvailableAsync()) throw new Error("CATALOG_SHARE_UNAVAILABLE");
  signal.throwIfAborted();
  const file = new fs.File(fs.Paths.cache, filename);
  // Never claim or overwrite a file that predates this attempt.
  if (file.exists) throw new Error("CATALOG_EXPORT_FILE_EXISTS");
  try {
    file.create();
    await file.write(csv);
    signal.throwIfAborted();
    await sharing.shareAsync(file.uri, { mimeType: "text/csv", dialogTitle: "تصدير كتالوج المتجر" });
  } finally {
    // The unique, previously absent path is ours even when creation throws
    // after allocating the file. Keep delivery busy until cleanup completes.
    if (file.exists) await file.delete();
  }
}

function exportFailure(error: unknown): string {
  if (error instanceof Error) {
    switch (error.message) {
      case "CATALOG_EXPORT_LIMIT":
        return "يتجاوز الكتالوج 5000 عرض. لم يُنشأ ملف جزئي.";
      case "CATALOG_IMPORT_TEMPLATE_EMPTY":
        return "لا توجد مسودات فريدة وآمنة للتعديل عبر الملف؛ لم يُنشأ ملف.";
    }
  }
  return "تعذّر إكمال التصدير. تحقّق من الاتصال والصلاحية ثم أعد المحاولة.";
}

function CatalogExportAction({ actorId, storeId, query, status }: ExportScope) {
  const { theme } = useMobileAppearance();
  const [phase, setPhase] = useState<ExportPhase>("idle");
  const [message, setMessage] = useState("");
  const active = useRef<ExportAttempt | null>(null);
  const busy = phase !== "idle";

  useLayoutEffect(() => () => {
    const previous = active.current;
    active.current = null;
    previous?.controller.abort();
  }, []);

  function cancel() {
    const operation = active.current;
    if (operation?.phase !== "collecting") return;
    active.current = null;
    operation.controller.abort();
    setPhase("idle");
    setMessage("أُلغي التصدير. يمكنك إعادة المحاولة.");
  }

  async function start(mode: ExportMode = "full") {
    if (active.current) return;
    const controller = new AbortController();
    const operation: ExportAttempt = { controller, phase: "collecting" };
    active.current = operation;
    setPhase("collecting");
    setMessage("");
    const timeout = setTimeout(() => controller.abort(), 120000);
    try {
      const result = await collectCatalogExport(
        actorId, storeId, controller.signal, readMerchantCatalogPage,
        mode === "filtered" ? { ...(query ? { query } : {}), ...(status ? { status } : {}) } : {},
        mode === "draft-edit" ? "draft-edit" : "report",
      );
      controller.signal.throwIfAborted();
      operation.phase = "delivering";
      // The read deadline does not govern the user's native share dialog.
      clearTimeout(timeout);
      setPhase("delivering");
      await deliverCsv(result.csv, controller.signal);
      if (active.current === operation && !controller.signal.aborted) {
        const notice = mode === "draft-edit"
          ? ["تم تجهيز", result.count, "مسودة للمراجعة؛ استُبعد", result.excluded ?? 0, "عرض غير مؤهل. أعد معاينة الملف قبل اعتماد أي تعديل."].join(" ")
          : `تم تجهيز ملف CSV بعدد ${result.count} عرض. تحقّق من التنزيل أو المشاركة.`;
        setMessage(notice);
      }
    } catch (error) {
      if (active.current === operation) setMessage(exportFailure(error));
    } finally {
      clearTimeout(timeout);
      if (active.current === operation) {
        active.current = null;
        setPhase("idle");
      }
    }
  }

  const buttonStyle = { minHeight: 44, justifyContent: "center" as const, borderColor: theme.borderColor,
    borderWidth: 1, borderRadius: 10, paddingHorizontal: 14, paddingVertical: 10 };
  return <View style={{ gap: 8 }}>
    <Pressable accessibilityRole="button" accessibilityLabel="تصدير كتالوج المتجر CSV"
      accessibilityState={{ busy, disabled: busy }} disabled={busy} onPress={() => void start()}
      style={buttonStyle}>
      <Text style={{ color: theme.interactiveText }}>{busy ? "جارٍ تجهيز التصدير…" : "تصدير الكتالوج (CSV)"}</Text>
    </Pressable>
    {query || status ? <Pressable accessibilityRole="button" accessibilityLabel="تصدير نتائج التصفية CSV"
      accessibilityState={{ busy, disabled: busy }} disabled={busy} onPress={() => void start("filtered")}
      style={buttonStyle}>
      <Text style={{ color: theme.interactiveText }}>تصدير نتائج التصفية (CSV)</Text>
    </Pressable> : null}
    <Pressable accessibilityRole="button" accessibilityLabel="تصدير ملف تعديل المسودات CSV"
      accessibilityState={{ busy, disabled: busy }} disabled={busy} onPress={() => void start("draft-edit")}
      style={buttonStyle}>
      <Text style={{ color: theme.interactiveText }}>تصدير ملف تعديل أسعار ومخزون المسودات (CSV)</Text>
    </Pressable>
    <Text style={{ color: theme.colorSecondary }}>ملف تعديل المسودات يستخدم الأعمدة الثلاثة المقبولة في الاستيراد. افتح الأعمدة كنص للحفاظ على القيم الدقيقة، ولا تغيّر الأسماء؛ أعد فحص الملف واعتمد الصفوف صراحة. لا يشمل العروض المنشورة أو الأسماء الملتبسة.</Text>
    {phase === "collecting" ? <Pressable accessibilityRole="button" accessibilityLabel="إلغاء تجهيز التصدير"
      onPress={cancel} style={buttonStyle}>
      <Text style={{ color: theme.interactiveText }}>إلغاء تجهيز التصدير</Text>
    </Pressable> : null}
    <Text style={{ color: theme.colorSecondary }}>
      يمكنك تصدير الكتالوج بالكامل أو جميع نتائج البحث والتصفية الحالية (حتى 5000 عرض).
      تُقرأ الصفحات من DSH تباعًا؛ لا يُعد الملف لقطة متزامنة إذا تغيّر الكتالوج أثناء القراءة. احفظه في مكان آمن.
    </Text>
    {message ? <Text accessibilityLiveRegion="polite" style={{ color: theme.color }}>{message}</Text> : null}
  </View>;
}

// The protected route without an admitted Store cannot invoke export.
export default function CatalogExport({ actorId, storeId, query, status }: Partial<ExportScope> = {}) {
  if (!actorId || !storeId) return <MerchantCapabilityScreen title="تصدير الكتالوج"
    message="افتح الكتالوج من مساحة التاجر الموثقة وحدد متجرك للتصدير." />;
  return <CatalogExportAction key={JSON.stringify([actorId, storeId, query, status])}
    actorId={actorId} storeId={storeId} query={query} status={status} />;
}
