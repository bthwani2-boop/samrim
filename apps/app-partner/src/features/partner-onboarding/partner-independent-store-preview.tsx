import type { IndependentStorePreview, PartnerAccessibleStore } from "@bthwani/dsh";
import { BthwaniButton, useAppearanceTheme } from "@bthwani/design-system/native";
import { useEffect, useMemo, useRef, useState } from "react";
import { Text, View } from "react-native";

import { createPartnerSurfaceStyles } from "./partner-surface-styles";
import { readOwnIndependentStorePreview } from "./store-readback-client";

/** Owner-only preparation preview; not a published link or an ordering surface. */
export function PartnerIndependentStorePreview({ store }: Readonly<{ store: PartnerAccessibleStore }>) {
  const theme = useAppearanceTheme();
  const styles = useMemo(() => createPartnerSurfaceStyles(theme), [theme]);
  const [preview, setPreview] = useState<IndependentStorePreview | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const generation = useRef(0);

  // The caller keys this component by Store ID, so unmount invalidates
  // in-flight reads before a different owner's Store can be displayed.
  useEffect(() => () => { generation.current += 1; }, []);

  async function readPage(cursor = "") {
    if (busy || !store.owned || store.relationModel !== "INDEPENDENT_STORE") return;
    const requestGeneration = ++generation.current;
    setBusy(true);
    setError("");
    try {
      const next = await readOwnIndependentStorePreview(store.id, cursor);
      if (requestGeneration !== generation.current) return;
      if (next.storeId !== store.id || next.relationModel !== "INDEPENDENT_STORE" ||
          next.previewOnly !== true || next.checkoutEnabled !== false ||
          (cursor && (cursor === next.nextCursor || !preview))) {
        throw new Error("INDEPENDENT_PREVIEW_SCOPE_INVALID");
      }
      setPreview(previous => cursor && previous
        ? { ...next, offers: [...previous.offers, ...next.offers] }
        : next);
    } catch {
      if (requestGeneration === generation.current) setError("تعذرت قراءة معاينة المتجر. تحقق من الاتصال ثم أعد المحاولة.");
    } finally {
      if (requestGeneration === generation.current) setBusy(false);
    }
  }

  if (!store.owned) {
    return <Text style={styles.muted}>معاينة المتجر المستقل خاصة بمالكه ولا تتاح لأعضاء الفريق.</Text>;
  }

  return <View style={{ gap: 8 }}>
    <Text style={styles.value}>معاينة المتجر المستقل</Text>
    <Text style={styles.muted}>هذه معاينة خاصة بالإعداد. المتجر غير منشور للزبائن، ولا يمكن إنشاء طلبات أو مشاركة رابط البيع حاليًا.</Text>
    {!preview
      ? <BthwaniButton label={busy ? "جارٍ تحميل المعاينة" : "عرض معاينة الكتالوج"} disabled={busy} onPress={() => void readPage()} />
      : <>
        <Text style={styles.value}>{preview.name}</Text>
        {preview.offers.length === 0 ? <Text style={styles.muted}>لا توجد منتجات في الكتالوج بعد.</Text> : null}
        {preview.offers.map(offer => (
          <View key={offer.id} style={styles.metaItem}>
            <Text style={styles.value}>{offer.title}</Text>
            <Text style={styles.muted}>{offer.priceMinor.toLocaleString("ar-YE")} {offer.currency} · {offer.availability ? "متاح في الكتالوج" : "غير متاح"} · {offer.publicationState === "published" ? "ظاهر في المعاينة" : "مسودة منتج"}</Text>
          </View>
        ))}
        {preview.nextCursor ? <BthwaniButton label={busy ? "جارٍ التحميل" : "عرض منتجات أخرى"} disabled={busy} variant="secondary" onPress={() => void readPage(preview.nextCursor)} /> : null}
        <BthwaniButton label="تحديث المعاينة" disabled={busy} variant="secondary" onPress={() => void readPage()} />
      </>}
    {error ? <Text accessibilityLiveRegion="polite" style={styles.error}>{error}</Text> : null}
  </View>;
}
