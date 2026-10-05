import { createDshMobileClient, formatMoney, type CatalogQuickPriceCommitResponse, type CatalogStoreOffer } from "@bthwani/dsh";
import { BthwaniButton, BthwaniChip, useAppearanceTheme } from "@bthwani/design-system/native";
import * as Crypto from "expo-crypto";
import { useCallback, useEffect, useMemo, useState } from "react";
import { ActivityIndicator, StyleSheet, Text, TextInput, View } from "react-native";

import { getUsableIdentityAccessToken } from "../../bootstrap/identity";
import { fieldClient } from "./field-client";

type Filter = "all" | "available" | "unavailable";
type PublicationFilter = "all" | "draft" | "published" | "hidden";

function client() {
  return fieldClient();
}

function changedRows(offers: ReadonlyArray<CatalogStoreOffer>, drafts: Readonly<Record<string, string>>): Array<{ offerId: string; expectedVersion: number; priceMinor: number }> {
  const changes: Array<{ offerId: string; expectedVersion: number; priceMinor: number }> = [];
  for (const offer of offers) {
    const draft = (drafts[offer.offerId] ?? String(offer.priceMinor)).trim();
    if (draft === String(offer.priceMinor)) continue;
    const parsed = Number(draft);
    if (Number.isSafeInteger(parsed) && parsed >= 1) changes.push({ offerId: offer.offerId, expectedVersion: offer.version, priceMinor: parsed });
  }
  return changes;
}

export function FieldQuickPrices({ caseId, verticalId, onPricesCommitted }: { caseId: string; verticalId: string; onPricesCommitted?: () => void }) {
  const theme = useAppearanceTheme();
  const styles = useMemo(() => StyleSheet.create({
    card: { backgroundColor: theme.surface, borderColor: theme.borderColor, borderRadius: 12, borderWidth: 1, gap: 10, padding: 14, width: "100%" },
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
    if (!caseId.trim()) return;
    setLoading(!append);
    setError("");
    try {
      const token = await getUsableIdentityAccessToken();
      const page = await client().listFieldQuickPrices(token, caseId, { ...filters, limit: 50, cursor });
      setOffers((current) => append ? [...current, ...page.offers.filter((offer) => !current.some((known) => known.offerId === offer.offerId))] : page.offers);
      setNextCursor(page.nextCursor ?? "");
    } catch (cause) {
      console.warn("DSH Field quick prices readback failed", cause);
      setError("تعذر قراءة الأسعار السريعة. حدّث القائمة وحاول مجددًا.");
    } finally {
      setLoading(false);
    }
  }, [caseId, filters]);

  useEffect(() => { void read(); }, [read]);

  useEffect(() => {
    let current = true;
    const timer = setTimeout(() => {
      void client().listCatalogCategories(verticalId, categoryQuery, 50).then((page) => {
        if (current) setCategoryOptions(page.categories.map((item) => ({ id: item.id, pathAr: item.pathAr })));
      }).catch((cause) => {
        if (current) {
          console.warn("DSH Field quick prices category filter read failed", cause);
          setError("تعذر قراءة قائمة الفئات.");
        }
      });
    }, 180);
    return () => { current = false; clearTimeout(timer); };
  }, [categoryQuery, verticalId]);

  function applyFilters() {
    setNotice("");
    setFilters({ q: queryDraft.trim(), categoryId: categoryDraft.trim(), availability: availabilityDraft, publicationState: publicationDraft });
  }

  const changes = useMemo(() => changedRows(offers, draftPrices), [draftPrices, offers]);

  async function commit() {
    if (busy || changes.length === 0) return;
    setBusy(true);
    setError("");
    setNotice("");
    try {
      const token = await getUsableIdentityAccessToken();
      const idempotency = { idempotencyKey: Crypto.randomUUID(), correlationID: Crypto.randomUUID() };
      const result: CatalogQuickPriceCommitResponse = await client().commitFieldQuickPrices(token, caseId, { items: changes }, idempotency.idempotencyKey, idempotency.correlationID);
      const byId = new Map(result.items.map((item) => [item.offerId, item]));
      setOffers((current) => current.map((offer) => {
        const updated = byId.get(offer.offerId);
        return updated && updated.offer ? updated.offer : offer;
      }));
      const conflicts = result.items.filter((item) => item.outcome === "VERSION_CONFLICT");
      for (const item of result.items) {
        if (item.outcome !== "VERSION_CONFLICT" && item.offer) setDraftPrices((current) => ({ ...current, [item.offerId]: String(item.offer.priceMinor) }));
      }
      setNotice(conflicts.length
        ? `${result.items.length - conflicts.length} سعرًا حُفظ. ${conflicts.length} صفًا تغيّر بإصدار أحدث؛ راجع السعر المحدّث ثم عدّله مرة أخرى إذا رغبت.`
        : `تم حفظ ${result.items.length} سعرًا مع إعادة القراءة من المصدر.`);
      onPricesCommitted?.();
    } catch (cause) {
      console.warn("DSH Field quick prices commit failed", cause);
      setError("تعذر حفظ الدفعة. أعد قراءة الأسعار قبل إعادة المحاولة.");
    } finally {
      setBusy(false);
    }
  }

  return <View accessibilityLabel="الأسعار السريعة" style={styles.card}>
    <Text style={styles.title}>الأسعار السريعة</Text>
    <Text style={styles.muted}>عدّل عدة أسعار دفعة واحدة قبل إطلاق المتجر. يُحفظ الصف فقط عند تغيّر سعره، ويظهر تعارض الإصدار للمراجعة قبل إعادة المحاولة.</Text>
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
      <Text style={styles.product}>{offer.productName} · {offer.variantTitle}</Text>
      <Text style={styles.muted}>{formatMoney(offer.priceMinor, offer.currency)} · {offer.availability ? "متاح" : "غير متاح"} · {offer.publicationState === "published" ? "منشور" : offer.publicationState === "hidden" ? "مخفي" : "مسودة"}</Text>
      <TextInput accessibilityLabel={`السعر الجديد لـ ${offer.productName}`} editable={!busy} keyboardType="number-pad" onChangeText={(value) => setDraftPrices((current) => ({ ...current, [offer.offerId]: value.replace(/[^0-9]/g, "") }))} placeholder="السعر بالريال اليمني" value={draftPrices[offer.offerId] ?? String(offer.priceMinor)} style={styles.input} />
    </View>)}
    {nextCursor ? <BthwaniButton busy={loading} disabled={loading || busy} label="تحميل المزيد" onPress={() => void read(nextCursor, true)} variant="secondary" /> : null}
    {offers.length ? <BthwaniButton busy={busy} disabled={busy || changes.length === 0} label={`حفظ الأسعار المتغيرة (${changes.length})`} onPress={() => void commit()} /> : null}
    {error ? <Text accessibilityRole="alert" style={styles.error}>{error}</Text> : null}
    {notice ? <Text accessibilityRole="text" accessibilityLiveRegion="polite" style={styles.muted}>{notice}</Text> : null}
  </View>;
}
