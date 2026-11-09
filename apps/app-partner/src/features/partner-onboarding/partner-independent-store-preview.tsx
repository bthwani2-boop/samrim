import type { IndependentStorePreview, PartnerAccessibleStore } from "@bthwani/dsh";
import { BthwaniButton, useAppearanceTheme } from "@bthwani/design-system/native";
import { Image as ExpoImage } from "expo-image";
import { useEffect, useMemo, useRef, useState } from "react";
import { Text, View } from "react-native";

import { currentIdentityState, subscribeIdentitySession } from "../../bootstrap/identity";
import { createPartnerSurfaceStyles } from "./partner-surface-styles";
import { partnerSetupSessionKey } from "./partner-setup-session-scope";
import { readOwnIndependentStorePreview } from "./store-readback-client";
import { PartnerIndependentCustomerPolicyDraftEditor } from "./partner-independent-customer-policy";

/** Owner-only preparation preview; never a published Store URL or an ordering surface. */
export function PartnerIndependentStorePreview({ store }: Readonly<{ store: PartnerAccessibleStore }>) {
  const theme = useAppearanceTheme();
  const styles = useMemo(() => createPartnerSurfaceStyles(theme), [theme]);
  const [preview, setPreview] = useState<IndependentStorePreview | null>(null);
  const [failedMedia, setFailedMedia] = useState<ReadonlySet<string>>(new Set());
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const generation = useRef(0);
  const readInFlight = useRef(false);
  const currentScope = useRef(partnerSetupSessionKey(currentIdentityState()));

  // The same Store ID may be visited under a different Identity session.
  // Discard private Store content and every outstanding response on that boundary.
  useEffect(() => {
    const unsubscribe = subscribeIdentitySession(next => {
      const scope = partnerSetupSessionKey(next);
      if (scope === currentScope.current) return;
      currentScope.current = scope;
      generation.current += 1;
      readInFlight.current = false;
      setPreview(null);
      setFailedMedia(new Set());
      setError("");
      setBusy(false);
    });
    return () => { unsubscribe(); generation.current += 1; readInFlight.current = false; };
  }, []);

  // Losing Store ownership or changing its relation must also clear private preview data.
  useEffect(() => {
    if (store.owned && store.relationModel === "INDEPENDENT_STORE") return;
    generation.current += 1;
    readInFlight.current = false;
    setPreview(null);
    setFailedMedia(new Set());
    setError("");
    setBusy(false);
  }, [store.owned, store.relationModel]);

  async function readPage(cursor = "") {
    const startingScope = partnerSetupSessionKey(currentIdentityState());
    if (busy || readInFlight.current || !startingScope || !store.owned || store.relationModel !== "INDEPENDENT_STORE") return;
    readInFlight.current = true;
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
      if (!cursor) setFailedMedia(new Set());
      setPreview(previous => !stillCurrent() ? previous : cursor && previous
        ? { ...next, offers: [...previous.offers, ...next.offers] }
        : next);
    } catch {
      if (stillCurrent()) setError("تعذرت قراءة معاينة المتجر. تحقق من الاتصال ثم أعد المحاولة.");
    } finally {
      if (stillCurrent()) {
        readInFlight.current = false;
        setBusy(false);
      }
    }
  }

  function media(uri: string, key: string, label: string, height: number) {
    const imageScope = partnerSetupSessionKey(currentIdentityState());
    if (!uri || failedMedia.has(key)) {
      return <View style={{ alignItems: "center", justifyContent: "center", minHeight: height, backgroundColor: theme.surfaceInset }}>
        <Text style={styles.muted}>{label} غير متاحة</Text>
      </View>;
    }
    return <ExpoImage
      accessibilityLabel={label}
      cachePolicy="none"
      contentFit="cover"
      onError={() => {
        if (imageScope && imageScope === currentScope.current && imageScope === partnerSetupSessionKey(currentIdentityState())) {
          setFailedMedia(previous => new Set([...previous, key]));
        }
      }}
      source={{ uri }}
      style={{ height, width: "100%" }}
    />;
  }

  if (!store.owned) {
    return <Text style={styles.muted}>معاينة المتجر المستقل خاصة بمالكه ولا تتاح لأعضاء الفريق.</Text>;
  }

  return <View style={{ gap: 10 }}>
    <Text accessibilityRole="header" style={styles.value}>معاينة موقع المتجر</Text>
    <Text style={styles.muted}>النشر العام للمتاجر المستقلة غير مفعّل حاليًا. هذه المعاينة خاصة بمالك المتجر.</Text>
    {!preview
      ? <BthwaniButton label={busy ? "جارٍ تحميل المعاينة" : "عرض معاينة المتجر"} disabled={busy} onPress={() => void readPage()} />
      : <>
        <View style={{ borderColor: theme.borderColor, borderRadius: 12, borderWidth: 1, overflow: "hidden" }}>
          {media(preview.coverImageUri, "store-cover", "غلاف المتجر", 155)}
          <View style={{ alignItems: "center", flexDirection: "row", gap: 12, padding: 12, backgroundColor: theme.surface }}>
            <View style={{ borderRadius: 36, height: 64, overflow: "hidden", width: 64 }}>
              {media(preview.profileImageUri, "store-profile", "شعار المتجر", 64)}
            </View>
            <View style={{ flex: 1, gap: 4 }}>
              <Text style={styles.value}>{preview.name}</Text>
              <Text style={styles.muted}>معاينة مالك فقط — {preview.publicationState === "PUBLISHED" ? "نشر DSH لا يعني جاهزية البيع العام" : "لم يُنشر للزبائن"}</Text>
            </View>
          </View>
        </View>
        <Text style={styles.value}>منتجات المتجر</Text>
        <Text style={styles.muted}>المنتجات المعروضة من كتالوج المتجر نفسه. لا يُفترض أنها قابلة للشراء قبل فحص النشر والتوفر والتسعير في DSH.</Text>
        {preview.offers.length === 0 ? <Text style={styles.muted}>لا توجد منتجات في هذه الصفحة من الكتالوج بعد. أضف منتجات من إدارة المتجر ثم حدّث المعاينة.</Text> : null}
        {preview.offers.map(offer => (
          <View key={offer.id} style={[styles.metaItem, { alignItems: "center", flexDirection: "row", gap: 10 }]}>
            <View style={{ borderRadius: 8, height: 86, overflow: "hidden", width: 86 }}>
              {media(offer.imageUri, `offer:${offer.id}`, `صورة ${offer.title}`, 86)}
            </View>
            <View style={{ flex: 1, gap: 4 }}>
              <Text style={styles.value}>{offer.title}</Text>
              <Text style={styles.muted}>{offer.priceMinor.toLocaleString("ar-YE")} {offer.currency}</Text>
              <Text style={styles.muted}>{offer.availability ? "متوفر في الكتالوج" : "غير متوفر"} · {offer.publicationState === "published" ? "منتج منشور" : "مسودة منتج"}</Text>
            </View>
          </View>
        ))}
        {preview.nextCursor ? <BthwaniButton label={busy ? "جارٍ التحميل" : "عرض منتجات أخرى"} disabled={busy} variant="secondary" onPress={() => void readPage(preview.nextCursor)} /> : null}
        <BthwaniButton label="تحديث المعاينة" disabled={busy} variant="secondary" onPress={() => void readPage()} />
      </>}
    {error ? <Text accessibilityLiveRegion="polite" style={styles.error}>{error}</Text> : null}
    <PartnerIndependentCustomerPolicyDraftEditor key={store.id} storeID={store.id} />
  </View>;
}
