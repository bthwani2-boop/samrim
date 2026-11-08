import type { IndependentStorePreview, PartnerAccessibleStore } from "@bthwani/dsh";
import { BthwaniButton, useAppearanceTheme } from "@bthwani/design-system/native";
import { useEffect, useMemo, useRef, useState } from "react";
import { Text, View } from "react-native";

import { currentIdentityState, subscribeIdentitySession } from "../../bootstrap/identity";
import { createPartnerSurfaceStyles } from "./partner-surface-styles";
import { partnerSetupSessionKey } from "./partner-setup-session-scope";
import { readOwnIndependentStorePreview } from "./store-readback-client";
import { PartnerIndependentCustomerPolicyDraftEditor } from "./partner-independent-customer-policy";

/** Owner-only preparation preview; not a published link or an ordering surface. */
export function PartnerIndependentStorePreview({ store }: Readonly<{ store: PartnerAccessibleStore }>) {
  const theme = useAppearanceTheme();
  const styles = useMemo(() => createPartnerSurfaceStyles(theme), [theme]);
  const [preview, setPreview] = useState<IndependentStorePreview | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const generation = useRef(0);
  const currentScope = useRef(partnerSetupSessionKey(currentIdentityState()));

  // Same Store ID may be visited in a different Identity session. Discard all
  // private preview data and in-flight reads at that boundary, not just on unmount.
  useEffect(() => {
    const unsubscribe = subscribeIdentitySession(next => {
      const scope = partnerSetupSessionKey(next);
      if (scope === currentScope.current) return;
      currentScope.current = scope;
      generation.current += 1;
      setPreview(null);
      setError("");
      setBusy(false);
    });
    return () => { unsubscribe(); generation.current += 1; };
  }, []);

  async function readPage(cursor = "") {
    const startingScope = partnerSetupSessionKey(currentIdentityState());
    if (busy || !startingScope || !store.owned || store.relationModel !== "INDEPENDENT_STORE") return;
    const requestGeneration = ++generation.current;
    const stillCurrent = () => requestGeneration === generation.current &&
      partnerSetupSessionKey(currentIdentityState()) === startingScope;
    setBusy(true);
    setError("");
    try {
      const next = await readOwnIndependentStorePreview(store.id, cursor);
      if (!stillCurrent()) return;
      if (next.storeId !== store.id || next.relationModel !== "INDEPENDENT_STORE" ||
          next.previewOnly !== true || next.checkoutEnabled !== false ||
          (cursor && (cursor === next.nextCursor || !preview))) {
        throw new Error("INDEPENDENT_PREVIEW_SCOPE_INVALID");
      }
      setPreview(previous => !stillCurrent() ? previous : cursor && previous
        ? { ...next, offers: [...previous.offers, ...next.offers] }
        : next);
    } catch {
      if (stillCurrent()) setError("تعذرت قراءة معاينة المتجر. تحقق من الاتصال ثم أعد المحاولة.");
    } finally {
      if (stillCurrent()) setBusy(false);
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
    <PartnerIndependentCustomerPolicyDraftEditor key={store.id} storeID={store.id} />
  </View>;
}
