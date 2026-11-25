import type { MerchantCatalogStatus } from "@bthwani/dsh";
import { useMobileAppearance } from "@bthwani/tamagui-config/appearance";
import { randomUUID } from "expo-crypto";
import { useLayoutEffect, useRef, useState } from "react";
import { Platform, Pressable, Text, View } from "react-native";
import MerchantCapabilityScreen from "../../components/merchant-capability-screen";
import { collectCatalogExport } from "./catalog-export-data";
import { readMerchantCatalogPage } from "./catalog-transport";

async function deliverCsv(csv: string, signal: AbortSignal) {
  const filename = `bthwani-catalog-${randomUUID()}.csv`;
  signal.throwIfAborted();
  if (Platform.OS === "web") {
    const url = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }));
    const link = document.createElement("a");
    try {
      link.href = url;
      link.download = filename;
      document.body.appendChild(link);
      signal.throwIfAborted();
      link.click();
    } finally {
      link.remove();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    }
    return;
  }
  const [fs, sharing] = await Promise.all([import("expo-file-system"), import("expo-sharing")]);
  if (!await sharing.isAvailableAsync()) throw new Error("CATALOG_SHARE_UNAVAILABLE");
  signal.throwIfAborted();
  const file = new fs.File(fs.Paths.cache, filename);
  let created = false;
  try {
    file.create();
    created = true;
    file.write(csv);
    signal.throwIfAborted();
    await sharing.shareAsync(file.uri, { mimeType: "text/csv", dialogTitle: "تصدير كتالوج المتجر" });
  } finally {
    if (created && file.exists) await file.delete();
  }
}

function CatalogExportAction({ actorId, storeId, query, status }: Readonly<{
  actorId: string; storeId: string; query?: string | undefined; status?: MerchantCatalogStatus | undefined;
}>) {
  const { theme } = useMobileAppearance();
  const [phase, setPhase] = useState<"idle" | "collecting" | "delivering">("idle");
  const busy = phase !== "idle";
  const [message, setMessage] = useState("");
  const active = useRef<{ controller: AbortController; collecting: boolean } | null>(null);

  useLayoutEffect(() => () => {
    active.current?.controller.abort();
    active.current = null;
  }, []);

  function cancel() {
    const operation = active.current;
    if (!operation?.collecting) return;
    operation.controller.abort();
    active.current = null;
    setPhase("idle");
    setMessage("أُلغي التصدير. يمكنك إعادة المحاولة.");
  }

  async function start(mode: "full" | "filtered" | "draft-edit" = "full") {
    if (active.current) return;
    const controller = new AbortController();
    const operation = { controller, collecting: true };
    active.current = operation;
    setPhase("collecting");
    setMessage("");
    const timeout = setTimeout(() => controller.abort(), 120000);
    try {
      const result = await collectCatalogExport(actorId, storeId, controller.signal, readMerchantCatalogPage,
        mode === "filtered" ? { ...(query ? { query } : {}), ...(status ? { status } : {}) } : {}, mode === "draft-edit" ? "draft-edit" : "report");
      // The last page and each preceding page are checked by DSH. A changed
      // mounted scope cancels the request before the file can be handed off.
      controller.signal.throwIfAborted();
      operation.collecting = false;
      setPhase("delivering");
      await deliverCsv(result.csv, controller.signal);
      if (active.current === operation && !controller.signal.aborted) {
        if (mode === "draft-edit") setMessage(["تم تجهيز", result.count, "مسودة للمراجعة؛ استُبعد", result.excluded ?? 0, "عرض غير مؤهل. أعد معاينة الملف قبل اعتماد أي تعديل."].join(" "));
        else setMessage(`تم تجهيز ملف CSV بعدد ${result.count} عرض. تحقّق من التنزيل أو المشاركة.`);
      }
    } catch (error) {
      if (active.current !== operation) return;
      setMessage(error instanceof Error && error.message === "CATALOG_EXPORT_LIMIT"
        ? "يتجاوز الكتالوج 5000 عرض. لم يُنشأ ملف جزئي."
        : error instanceof Error && error.message === "CATALOG_IMPORT_TEMPLATE_EMPTY"
          ? "لا توجد مسودات فريدة وآمنة للتعديل عبر الملف؛ لم يُنشأ ملف."
          : "تعذّر إكمال التصدير. تحقّق من الاتصال والصلاحية ثم أعد المحاولة.");
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

// The protected legacy route has no owner scope and cannot invoke export.
// The active verified Merchant workspace passes its current actor and Store.
export default function CatalogExport({ actorId, storeId, query, status }: Readonly<{
  actorId?: string; storeId?: string; query?: string | undefined; status?: MerchantCatalogStatus | undefined;
}> = {}) {
  if (!actorId || !storeId) return <MerchantCapabilityScreen title="تصدير الكتالوج"
    message="افتح الكتالوج من مساحة التاجر الموثقة وحدد متجرك للتصدير." />;
  return <CatalogExportAction key={JSON.stringify([actorId, storeId, query, status])}
    actorId={actorId} storeId={storeId} query={query} status={status} />;
}
