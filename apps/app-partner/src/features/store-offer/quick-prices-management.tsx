import { formatMoney, createDshMobileClient, type CatalogQuickPriceCommitResponse, type CatalogStoreOffer } from "@bthwani/dsh";
import { BthwaniButton, BthwaniChip, useAppearanceTheme } from "@bthwani/design-system/native";
import * as Crypto from "expo-crypto";
import { useCallback, useEffect, useMemo, useState } from "react";
import { ActivityIndicator, StyleSheet, Text, TextInput, View } from "react-native";

import { getUsableIdentityAccessToken } from "../../bootstrap/identity";

type Filter = "all" | "available" | "unavailable";
type PublicationFilter = "all" | "draft" | "published" | "hidden";

function client() {
  const value = process.env.EXPO_PUBLIC_DSH_API_URL?.trim();
  if (!value) throw new Error("DSH_BASE_URL_REQUIRED");
  return createDshMobileClient(value, { cryptoRandomUUID: () => Crypto.randomUUID() });
}

export function QuickPricesManagement({ storeId, verticalId }: { storeId: string; verticalId: string }) {
  const theme = useAppearanceTheme();
  const styles = useMemo(() => StyleSheet.create({
    block: { backgroundColor: theme.surfaceRaised, borderColor: theme.borderColor, borderRadius: 12, borderWidth: 1, gap: 10, marginTop: 12, padding: 14 },
    title: { color: theme.color, fontSize: 18, fontWeight: "700" },
    muted: { color: theme.colorMuted, fontSize: 14 },
    error: { color: theme.danger, fontSize: 14 },
    row: { borderColor: theme.borderColor, borderTopWidth: 1, gap: 8, paddingTop: 10 },
    product: { color: theme.color, fontSize: 15, fontWeight: "600" },
    input: { backgroundColor: theme.surface, borderColor: theme.borderColor, borderRadius: 8, borderWidth: 1, color: theme.color, minHeight: 44, paddingHorizontal: 10, textAlign: "left", writingDirection: "ltr" },
    filters: { flexDirection: "row", flexWrap: "wrap", gap: 6 },
  }), [theme]);
  const [offers, setOffers] = useState<ReadonlyArray<CatalogStoreOffer>>([]);
  const [draftPrices, setDraftPrices] = useState<Readonly<Record<string, string>>>({});
  const [selected, setSelected] = useState<ReadonlySet<string>>(new Set());
  const [queryDraft, setQueryDraft] = useState("");
  const [categoryDraft, setCategoryDraft] = useState("");
  const [categoryQuery, setCategoryQuery] = useState("");
  const [categoryOptions, setCategoryOptions] = useState<ReadonlyArray<{ id: string; pathAr: string }>>([]);
  const [availabilityDraft, setAvailabilityDraft] = useState<Filter>("all");
  const [publicationDraft, setPublicationDraft] = useState<PublicationFilter>("all");
  const [filters, setFilters] = useState({ q: "", categoryId: "", availability: "all" as Filter, publicationState: "all" as PublicationFilter });
  const [nextCursor, setNextCursor] = useState("");
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  const read = useCallback(async (cursor = "", append = false) => {
    if (!storeId.trim()) return;
    setLoading(!append);
    setError("");
    try {
      const token = await getUsableIdentityAccessToken();
      const page = await client().listOwnStoreQuickPrices(token, storeId, { ...filters, limit: 50, cursor });
      setOffers((current) => append ? [...current, ...page.offers.filter((offer) => !current.some((known) => known.offerId === offer.offerId))] : page.offers);
      setNextCursor(page.nextCursor ?? "");
    } catch (cause) {
      console.warn("DSH Quick Prices readback failed", cause);
      setError("تعذر قراءة الأسعار السريعة. حدّث القائمة وحاول مجددًا.");
    } finally {
      setLoading(false);
    }
  }, [filters, storeId]);

  useEffect(() => { void read(); }, [read]);

  useEffect(() => {
    let current = true;
    const timer = setTimeout(() => {
      void client().listCatalogCategories(verticalId, categoryQuery, 50).then((page) => {
        if (current) setCategoryOptions(page.categories.map((item) => ({ id: item.id, pathAr: item.pathAr })));
      }).catch((cause) => {
        if (current) {
          console.warn("DSH Quick Prices category filter read failed", cause);
          setError("تعذر قراءة قائمة الفئات.");
        }
      });
    }, 180);
    return () => { current = false; clearTimeout(timer); };
  }, [categoryQuery, verticalId]);

  function applyFilters() {
    setSelected(new Set());
    setNotice("");
    setFilters({ q: queryDraft.trim(), categoryId: categoryDraft.trim(), availability: availabilityDraft, publicationState: publicationDraft });
  }

  function toggle(offerId: string) {
    setSelected((current) => {
      const next = new Set(current);
      if (next.has(offerId)) next.delete(offerId); else next.add(offerId);
      return next;
    });
  }

  async function commit() {
    if (busy || selected.size === 0) return;
    const changes = offers.filter((offer) => selected.has(offer.offerId)).map((offer) => ({
      offerId: offer.offerId,
      expectedVersion: offer.version,
      priceMinor: Number((draftPrices[offer.offerId] ?? String(offer.priceMinor)).trim()),
    }));
    if (changes.some((item) => !Number.isSafeInteger(item.priceMinor) || item.priceMinor < 1)) {
      setError("أدخل سعرًا صحيحًا موجبًا لكل صف محدد.");
      return;
    }
    setBusy(true);
    setError("");
    setNotice("");
    try {
      const token = await getUsableIdentityAccessToken();
      const result: CatalogQuickPriceCommitResponse = await client().commitOwnStoreQuickPrices(token, storeId, { items: changes });
      const byId = new Map(result.items.map((item) => [item.offerId, item]));
      setOffers((current) => current.map((offer) => {
        const updated = byId.get(offer.offerId);
        return updated ? updated.offer : offer;
      }));
      const conflicts = result.items.filter((item) => item.outcome === "VERSION_CONFLICT");
      const unchanged = result.items.filter((item) => item.outcome === "UNCHANGED");
      const saved = result.items.length - conflicts.length - unchanged.length;
      setSelected(new Set());
      for (const item of result.items) {
        if (item.outcome !== "VERSION_CONFLICT") setDraftPrices((current) => ({ ...current, [item.offerId]: String(item.offer.priceMinor) }));
      }
      setNotice([
        conflicts.length ? `${conflicts.length} صفًا تغيّر بإصدار أحدث؛ راجع السعر المحدّث ثم حدده مرة أخرى إذا رغبت.` : "",
        unchanged.length ? `${unchanged.length} صفًا لم يتغيّر سعره فلم يُعدّل.` : "",
        saved ? `تم حفظ ${saved} سعرًا مع إعادة القراءة من المصدر.` : "",
      ].filter(Boolean).join(" "));
    } catch (cause) {
      console.warn("DSH Quick Prices commit failed", cause);
      setError("تعذر حفظ الدفعة. أعد قراءة الأسعار قبل إعادة المحاولة.");
    } finally {
      setBusy(false);
    }
  }

  return <View accessibilityLabel="الأسعار السريعة" style={styles.block}>
    <Text style={styles.title}>الأسعار السريعة</Text>
    <Text style={styles.muted}>رشّح عروض المتجر وعدّل عدة أسعار دفعة واحدة. تُرفض القيم غير الصالحة ويظهر تعارض الإصدار للمراجعة قبل إعادة المحاولة.</Text>
    <TextInput accessibilityLabel="بحث الأسعار السريعة" editable={!busy} onChangeText={setQueryDraft} onSubmitEditing={applyFilters} placeholder="ابحث باسم المنتج أو النسخة" returnKeyType="search" value={queryDraft} style={styles.input} />
    <TextInput accessibilityLabel="بحث فئات الأسعار السريعة" editable={!busy} onChangeText={setCategoryQuery} placeholder="ابحث عن فئة لتصفية النتائج" value={categoryQuery} style={styles.input} />
    <View style={styles.filters}>
      <BthwaniChip disabled={busy} label="كل الفئات" onPress={() => setCategoryDraft("")} selected={!categoryDraft} />
      {categoryOptions.map((category) => <BthwaniChip key={category.id} disabled={busy} label={category.pathAr} onPress={() => setCategoryDraft(category.id)} selected={categoryDraft === category.id} />)}
    </View>
    <View style={styles.filters}>
      {(["all", "available", "unavailable"] as const).map((value) => <BthwaniChip key={value} disabled={busy} label={value === "all" ? "كل حالات التوافر" : value === "available" ? "متاح" : "غير متاح"} onPress={() => setAvailabilityDraft(value)} selected={availabilityDraft === value} />)}
    </View>
    <View style={styles.filters}>
      {(["all", "draft", "published", "hidden"] as const).map((value) => <BthwaniChip key={value} disabled={busy} label={value === "all" ? "كل حالات النشر" : value === "draft" ? "مسودة" : value === "published" ? "منشور" : "مخفي"} onPress={() => setPublicationDraft(value)} selected={publicationDraft === value} />)}
    </View>
    <BthwaniButton busy={loading} disabled={busy || loading} label="تطبيق المرشحات" onPress={applyFilters} variant="secondary" />
    {loading ? <View style={{ alignItems: "center", gap: 6 }}><ActivityIndicator color={theme.actionBackground} /><Text style={styles.muted}>جارٍ قراءة النتائج…</Text></View> : null}
    {!loading && !offers.length ? <Text style={styles.muted}>لا توجد عروض مطابقة لهذه المرشحات.</Text> : null}
    {offers.map((offer) => <View key={offer.offerId} style={styles.row}>
      <BthwaniChip disabled={busy} label={selected.has(offer.offerId) ? "محدد للتحديث" : "تحديد للتحديث"} onPress={() => toggle(offer.offerId)} selected={selected.has(offer.offerId)} />
      <Text style={styles.product}>{offer.productName} · {offer.variantTitle}</Text>
      <Text style={styles.muted}>{formatMoney(offer.priceMinor, offer.currency)} · {offer.availability ? "متاح" : "غير متاح"} · {offer.publicationState === "published" ? "منشور" : offer.publicationState === "hidden" ? "مخفي" : "مسودة"}</Text>
      <TextInput accessibilityLabel={`السعر الجديد لـ ${offer.productName}`} editable={!busy} keyboardType="number-pad" onChangeText={(value) => setDraftPrices((current) => ({ ...current, [offer.offerId]: value.replace(/[^0-9]/g, "") }))} placeholder="السعر بالريال اليمني" value={draftPrices[offer.offerId] ?? String(offer.priceMinor)} style={styles.input} />
    </View>)}
    {nextCursor ? <BthwaniButton busy={loading} disabled={loading || busy} label="تحميل المزيد" onPress={() => void read(nextCursor, true)} variant="secondary" /> : null}
    {offers.length ? <BthwaniButton busy={busy} disabled={busy || selected.size === 0} label={`حفظ الأسعار المحددة (${selected.size})`} onPress={() => void commit()} /> : null}
    {error ? <Text accessibilityRole="alert" style={styles.error}>{error}</Text> : null}
    {notice ? <Text accessibilityRole="text" accessibilityLiveRegion="polite" style={styles.muted}>{notice}</Text> : null}
  </View>;
}
