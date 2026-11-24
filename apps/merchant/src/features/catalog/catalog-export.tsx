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
    if (created && file.exists) file.delete();
  }
}

function CatalogExportAction({ actorId, storeId }: Readonly<{ actorId: string; storeId: string }>) {
  const { theme } = useMobileAppearance();
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const active = useRef<AbortController | null>(null);

  useLayoutEffect(() => () => {
    active.current?.abort();
    active.current = null;
  }, []);

  async function start() {
    if (active.current) return;
    const controller = new AbortController();
    active.current = controller;
    setBusy(true);
    setMessage("");
    const timeout = setTimeout(() => controller.abort(), 120000);
    try {
      const result = await collectCatalogExport(actorId, storeId, controller.signal, readMerchantCatalogPage);
      // The last page and each preceding page are checked by DSH. A changed
      // mounted scope cancels the request before the file can be handed off.
      await deliverCsv(result.csv, controller.signal);
      if (active.current === controller && !controller.signal.aborted) {
        setMessage(`تم تجهيز ملف CSV بعدد ${result.count} عرض. تحقّق من التنزيل أو المشاركة.`);
      }
    } catch (error) {
      if (active.current !== controller) return;
      setMessage(error instanceof Error && error.message === "CATALOG_EXPORT_LIMIT"
        ? "يتجاوز الكتالوج 5000 عرض. لم يُنشأ ملف جزئي."
        : "تعذّر إكمال التصدير. تحقّق من الاتصال والصلاحية ثم أعد المحاولة.");
    } finally {
      clearTimeout(timeout);
      if (active.current === controller) {
        active.current = null;
        setBusy(false);
      }
    }
  }

  return <View style={{ gap: 8 }}>
    <Pressable accessibilityRole="button" accessibilityLabel="تصدير كتالوج المتجر CSV"
      accessibilityState={{ busy, disabled: busy }} disabled={busy} onPress={() => void start()}
      style={{ minHeight: 44, justifyContent: "center", borderColor: theme.borderColor,
        borderWidth: 1, borderRadius: 10, paddingHorizontal: 14, paddingVertical: 10 }}>
      <Text style={{ color: theme.interactiveText }}>{busy ? "جارٍ تجهيز التصدير…" : "تصدير الكتالوج (CSV)"}</Text>
    </Pressable>
    <Text style={{ color: theme.colorSecondary }}>
      يشمل التصدير عروض المتجر ومسوداته (حتى 5000 عرض)، دون تصفية البحث الحالية. تُقرأ الصفحات من DSH تباعًا؛
      لا يُعد الملف لقطة متزامنة إذا تغيّر الكتالوج أثناء القراءة. احفظه في مكان آمن.
    </Text>
    {message ? <Text accessibilityLiveRegion="polite" style={{ color: theme.color }}>{message}</Text> : null}
  </View>;
}

// The protected legacy route has no owner scope and cannot invoke export.
// The active verified Merchant workspace passes its current actor and Store.
export default function CatalogExport({ actorId, storeId }: Readonly<{ actorId?: string; storeId?: string }> = {}) {
  if (!actorId || !storeId) return <MerchantCapabilityScreen title="تصدير الكتالوج"
    message="افتح الكتالوج من مساحة التاجر الموثقة وحدد متجرك للتصدير." />;
  return <CatalogExportAction key={JSON.stringify([actorId, storeId])} actorId={actorId} storeId={storeId} />;
}
