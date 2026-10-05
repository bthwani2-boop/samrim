import { BthwaniButton, BthwaniChip, useAppearanceTheme } from "@bthwani/design-system/native";
import { useCallback, useEffect, useMemo, useState } from "react";
import { ActivityIndicator, StyleSheet, Text, TextInput, View } from "react-native";

import type { CatalogQuickPriceCommitRequest, CatalogQuickPriceCommitResponse, CatalogQuickPriceUpdate, CatalogStoreOffer } from "./generated/dsh-types";
import { formatMoney } from "./presentation/order-presentation";
import { createDshMobileClient } from "./mobile";

type StoreQuickPricesScope = Readonly<{ kind: "FIELD"; joiningCaseID: string }> | Readonly<{ kind: "PARTNER"; storeID: string }>;
type QuickPriceChange = CatalogQuickPriceUpdate;
type QuickPriceAttempt = Readonly<{ fingerprint: string; idempotencyKey: string; correlationID: string }>;
type QuickPriceFilter = "all" | "available" | "unavailable";
type QuickPricePublicationFilter = "all" | "draft" | "published" | "hidden";

export type MobileStoreQuickPricesWorkspaceProps = Readonly<{
  client: ReturnType<typeof createDshMobileClient>;
  scope: StoreQuickPricesScope;
  verticalId: string;
  getAccessToken: () => Promise<string>;
  createUUID: () => string;
  onPricesCommitted?: () => void | Promise<void>;
}>;

const quickPriceAvailabilityFilters: ReadonlyArray<{ value: QuickPriceFilter; label: string }> = [
  { value: "all", label: "كل حالات التوافر" },
  { value: "available", label: "متاح" },
  { value: "unavailable", label: "غير متاح" },
];

const quickPricePublicationFilters: ReadonlyArray<{ value: QuickPricePublicationFilter; label: string }> = [
  { value: "all", label: "كل حالات النشر" },
  { value: "draft", label: "مسودة" },
  { value: "published", label: "منشور" },
  { value: "hidden", label: "مخفي" },
];

function quickPricePublicationLabel(state: CatalogStoreOffer["publicationState"]): string {
  switch (state) {
    case "published": return "منشور";
    case "hidden": return "مخفي";
    default: return "مسودة";
  }
}

function scopeIntroduction(scope: StoreQuickPricesScope): string {
  return scope.kind === "FIELD"
    ? "عدّل عدة أسعار دفعة واحدة قبل إطلاق المتجر. يُحفظ الصف فقط عند تغيّر سعره، ويظهر تعارض الإصدار للمراجعة قبل إعادة المحاولة."
    : "رشّح عروض المتجر وعدّل عدة أسعار دفعة واحدة. يُحفظ الصف فقط عند تغيّر سعره، ويظهر تعارض الإصدار للمراجعة قبل إعادة المحاولة.";
}

function changedQuickPriceRows(offers: ReadonlyArray<CatalogStoreOffer>, drafts: Readonly<Record<string, string>>): ReadonlyArray<QuickPriceChange> {
  const changes: Array<QuickPriceChange> = [];
  for (const offer of offers) {
    const draft = (drafts[offer.offerId] ?? String(offer.priceMinor)).trim();
    if (draft === String(offer.priceMinor)) continue;
    const parsed = Number(draft);
    if (Number.isSafeInteger(parsed) && parsed >= 1) changes.push({ offerId: offer.offerId, expectedVersion: offer.version, priceMinor: parsed });
  }
  return changes;
}

function changesFingerprint(changes: ReadonlyArray<QuickPriceChange>): string {
  return [...changes].map((change) => `${change.offerId}:${change.priceMinor}`).join("|");
}

function quickPriceCommitNotice(result: CatalogQuickPriceCommitResponse): string {
  const conflicts = result.items.filter((item) => item.outcome === "VERSION_CONFLICT");
  const saved = result.items.length - conflicts.length;
  return [
    conflicts.length ? `${conflicts.length} صفًا تغيّر بإصدار أحدث؛ راجع السعر المحدّث ثم عدّله مرة أخرى إذا رغبت.` : "",
    saved ? `تم حفظ ${saved} سعرًا مع إعادة القراءة من المصدر.` : "",
  ].filter(Boolean).join(" ");
}

export function MobileStoreQuickPricesWorkspace({ client, scope, verticalId, getAccessToken, createUUID, onPricesCommitted }: MobileStoreQuickPricesWorkspaceProps) {
  const theme = useAppearanceTheme();
  const styles = useMemo(() => StyleSheet.create({
    card: { backgroundColor: theme.surfaceRaised, borderColor: theme.borderColor, borderRadius: 12, borderWidth: 1, gap: 10, marginTop: 12, padding: 14 },
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
  const [availabilityDraft, setAvailabilityDraft] = useState<QuickPriceFilter>("all");
  const [publicationDraft, setPublicationDraft] = useState<QuickPricePublicationFilter>("all");
  const [filters, setFilters] = useState({ q: "", categoryId: "", availability: "all" as QuickPriceFilter, publicationState: "all" as QuickPricePublicationFilter });
  const [nextCursor, setNextCursor] = useState("");
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [attempt, setAttempt] = useState<QuickPriceAttempt | null>(null);

  const read = useCallback(async (cursor = "", append = false) => {
    const scopeKey = scope.kind === "FIELD" ? scope.joiningCaseID : scope.storeID;
    if (!scopeKey.trim()) return;
    setLoading(!append);
    setError("");
    try {
      const token = await getAccessToken();
      const page = scope.kind === "FIELD"
        ? await client.listFieldQuickPrices(token, scope.joiningCaseID, { ...filters, limit: 50, cursor })
        : await client.listOwnStoreQuickPrices(token, scope.storeID, { ...filters, limit: 50, cursor });
      setOffers((current) => append ? [...current, ...page.offers.filter((offer) => !current.some((known) => known.offerId === offer.offerId))] : page.offers);
      setNextCursor(page.nextCursor ?? "");
    } catch (cause) {
      console.warn("DSH Store quick prices readback failed", cause);
      setError("تعذر قراءة الأسعار السريعة. حدّث القائمة وحاول مجددًا.");
    } finally {
      setLoading(false);
    }
  }, [client, filters, getAccessToken, scope]);

  useEffect(() => { void read(); }, [read]);

  useEffect(() => {
    let current = true;
    const timer = setTimeout(() => {
      void client.listCatalogCategories(verticalId, categoryQuery, 50).then((page) => {
        if (current) setCategoryOptions(page.categories.map((item) => ({ id: item.id, pathAr: item.pathAr })));
      }).catch((cause) => {
        if (current) {
          console.warn("DSH Store quick prices category filter read failed", cause);
          setError("تعذر قراءة قائمة الفئات.");
        }
      });
    }, 180);
    return () => { current = false; clearTimeout(timer); };
  }, [categoryQuery, client, verticalId]);

  function applyFilters() {
    setNotice("");
    setFilters({ q: queryDraft.trim(), categoryId: categoryDraft.trim(), availability: availabilityDraft, publicationState: publicationDraft });
  }

  const changes = useMemo(() => changedQuickPriceRows(offers, draftPrices), [draftPrices, offers]);

  async function commit() {
    if (busy || changes.length === 0) return;
    const fingerprint = changesFingerprint(changes);
    const currentAttempt = attempt?.fingerprint === fingerprint ? attempt : { fingerprint, idempotencyKey: createUUID(), correlationID: createUUID() };
    if (currentAttempt !== attempt) setAttempt(currentAttempt);
    setBusy(true);
    setError("");
    setNotice("");
    try {
      const token = await getAccessToken();
      const input: CatalogQuickPriceCommitRequest = { items: changes.map((change) => ({ ...change })) };
      const result: CatalogQuickPriceCommitResponse = scope.kind === "FIELD"
        ? await client.commitFieldQuickPrices(token, scope.joiningCaseID, input, currentAttempt.idempotencyKey, currentAttempt.correlationID)
        : await client.commitOwnStoreQuickPrices(token, scope.storeID, input, currentAttempt.idempotencyKey, currentAttempt.correlationID);
      const byId = new Map(result.items.map((item) => [item.offerId, item]));
      setOffers((current) => current.map((offer) => {
        const updated = byId.get(offer.offerId);
        return updated && updated.offer ? updated.offer : offer;
      }));
      for (const item of result.items) {
        if (item.outcome !== "VERSION_CONFLICT" && item.offer) setDraftPrices((current) => ({ ...current, [item.offerId]: String(item.offer.priceMinor) }));
      }
      setNotice(quickPriceCommitNotice(result));
      if (result.items.every((item) => item.outcome !== "VERSION_CONFLICT")) {
        setAttempt(null);
        await onPricesCommitted?.();
      }
    } catch (cause) {
      console.warn("DSH Store quick prices commit failed", cause);
      setError("تعذر حفظ الدفعة. أعد قراءة الأسعار قبل إعادة المحاولة.");
    } finally {
      setBusy(false);
    }
  }

  return <View accessibilityLabel="الأسعار السريعة" style={styles.card}>
    <Text style={styles.title}>الأسعار السريعة</Text>
    <Text style={styles.muted}>{scopeIntroduction(scope)}</Text>
    <TextInput accessibilityLabel="بحث الأسعار السريعة" editable={!busy} onChangeText={setQueryDraft} onSubmitEditing={applyFilters} placeholder="ابحث باسم المنتج أو النسخة" returnKeyType="search" value={queryDraft} style={styles.input} />
    <TextInput accessibilityLabel="بحث فئات الأسعار السريعة" editable={!busy} onChangeText={setCategoryQuery} placeholder="ابحث عن فئة لتصفية النتائج" value={categoryQuery} style={styles.input} />
    <View style={styles.filters}>
      <BthwaniChip disabled={busy} label="كل الفئات" onPress={() => setCategoryDraft("")} selected={!categoryDraft} />
      {categoryOptions.map((category) => <BthwaniChip key={category.id} disabled={busy} label={category.pathAr} onPress={() => setCategoryDraft(category.id)} selected={categoryDraft === category.id} />)}
    </View>
    <View style={styles.filters}>
      {quickPriceAvailabilityFilters.map((filter) => <BthwaniChip key={filter.value} disabled={busy} label={filter.label} onPress={() => setAvailabilityDraft(filter.value)} selected={availabilityDraft === filter.value} />)}
    </View>
    <View style={styles.filters}>
      {quickPricePublicationFilters.map((filter) => <BthwaniChip key={filter.value} disabled={busy} label={filter.label} onPress={() => setPublicationDraft(filter.value)} selected={publicationDraft === filter.value} />)}
    </View>
    <BthwaniButton busy={loading} disabled={busy || loading} label="تطبيق المرشحات" onPress={applyFilters} variant="secondary" />
    {loading ? <View style={{ alignItems: "center", gap: 6 }}><ActivityIndicator color={theme.actionBackground} /><Text style={styles.muted}>جارٍ قراءة النتائج…</Text></View> : null}
    {!loading && !offers.length ? <Text style={styles.muted}>لا توجد عروض مطابقة لهذه المرشحات.</Text> : null}
    {offers.map((offer) => <View key={offer.offerId} style={styles.row}>
      <Text style={styles.product}>{offer.productName} · {offer.variantTitle}</Text>
      <Text style={styles.muted}>{formatMoney(offer.priceMinor, offer.currency)} · {offer.availability ? "متاح" : "غير متاح"} · {quickPricePublicationLabel(offer.publicationState)}</Text>
      <TextInput accessibilityLabel={`السعر الجديد لـ ${offer.productName}`} editable={!busy} keyboardType="number-pad" onChangeText={(value) => setDraftPrices((current) => ({ ...current, [offer.offerId]: value.replace(/\D/g, "") }))} placeholder="السعر بالريال اليمني" value={draftPrices[offer.offerId] ?? String(offer.priceMinor)} style={styles.input} />
    </View>)}
    {nextCursor ? <BthwaniButton busy={loading} disabled={loading || busy} label="تحميل المزيد" onPress={() => void read(nextCursor, true)} variant="secondary" /> : null}
    {offers.length ? <BthwaniButton busy={busy} disabled={busy || changes.length === 0} label={`حفظ الأسعار المتغيرة (${changes.length})`} onPress={() => void commit()} /> : null}
    {error ? <Text accessibilityRole="alert" style={styles.error}>{error}</Text> : null}
    {notice ? <Text accessibilityRole="text" accessibilityLiveRegion="polite" style={styles.muted}>{notice}</Text> : null}
  </View>;
}
