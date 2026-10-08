import { borders, radius, resolveTheme, spacing, typography } from "@bthwani/design-system";
import { BthwaniButton, BthwaniChip, BthwaniConfirmDialog, BthwaniSurface, useAppearanceTheme } from "@bthwani/design-system/native";
import { createDshMobileClient, formatMoney, type CatalogCategoryListItem, type CatalogProduct, type OperatorPromotionRegistryResponse, type PartnerCampaignListResponse, type PartnerCampaignView, type PromotionTarget, type PromotionView } from "@bthwani/dsh";
import * as Crypto from "expo-crypto";
import { useCallback, useEffect, useMemo, useState } from "react";
import { ActivityIndicator, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
import { currentIdentityState, getUsableIdentityAccessToken } from "../../bootstrap/identity";

type TargetKind = "NONE" | PromotionTarget["targetKind"];
type TargetOption = Readonly<{ id: string; label: string }>;

function client() {
  const baseUrl = process.env.EXPO_PUBLIC_DSH_API_URL?.trim();
  if (!baseUrl) throw new Error("DSH_BASE_URL_REQUIRED");
  return createDshMobileClient(baseUrl, { cryptoRandomUUID: () => Crypto.randomUUID() });
}

function lifecycleBucket(promotion: PromotionView, now: number): "active" | "scheduled" | "ended" {
  if (promotion.state === "ENDED") return "ended";
  if (promotion.state === "DRAFT" || promotion.state === "PAUSED") return "scheduled";
  const start = Date.parse(promotion.startsAt);
  const end = promotion.endsAt ? Date.parse(promotion.endsAt) : Number.POSITIVE_INFINITY;
  if (now >= start && now < end) return "active";
  if (now < start) return "scheduled";
  return "ended";
}

function benefitLabel(promotion: PromotionView): string {
  return promotion.kind === "PERCENTAGE" ? "خصم " + promotion.valueMinor + "%" : "خصم " + formatMoney(promotion.valueMinor, "YER");
}

function fundingLabel(promotion: PromotionView): string {
  if (promotion.fundingSource === "BTHWANI") return "تمويل بثواني";
  if (promotion.fundingSource === "SHARED") return "تمويل مشترك · حصة الشريك " + (promotion.fundingSharePartnerPercent ?? 0) + "%";
  return "تمويل الشريك";
}

function optionalPositiveInt(value: string): number | undefined {
  if (!value.trim()) return undefined;
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed <= 0) throw new Error("INVALID_FORM");
  return parsed;
}

function parseDate(value: string, fallbackNow = false): Date | undefined {
  if (!value.trim()) return fallbackNow ? new Date() : undefined;
  const match = /^(\d{2})\/(\d{2})\/(\d{4})\s+(\d{2}):(\d{2})$/.exec(value.trim());
  if (!match) throw new Error("INVALID_FORM");
  const [day, month, year, hour, minute] = match.slice(1).map(Number);
  if (day === undefined || month === undefined || year === undefined || hour === undefined || minute === undefined || month < 1 || month > 12 || day < 1 || day > 31 || hour > 23 || minute > 59) throw new Error("INVALID_FORM");
  const localAsUtc = Date.UTC(year, month - 1, day, hour, minute);
  const instant = new Date(localAsUtc - 3 * 60 * 60 * 1000);
  const normalizedLocal = new Date(instant.getTime() + 3 * 60 * 60 * 1000);
  if (normalizedLocal.getUTCFullYear() !== year || normalizedLocal.getUTCMonth() + 1 !== month || normalizedLocal.getUTCDate() !== day || normalizedLocal.getUTCHours() !== hour || normalizedLocal.getUTCMinutes() !== minute) throw new Error("INVALID_FORM");
  return instant;
}

function requiresPartnerOptIn(promotion: PromotionView): boolean {
  return "requiresPartnerOptIn" in promotion && promotion.requiresPartnerOptIn === true;
}

function minOrderSubtotalMinor(promotion: PromotionView): number {
  if (!("minOrderSubtotalMinor" in promotion)) return 0;
  const value = promotion.minOrderSubtotalMinor;
  return typeof value === "number" ? value : 0;
}

function promotionScopeLabel(promotion: PromotionView): string {
  const targets = promotion.targets ?? [];
  if (targets.length === 0) return "النطاق: كل المتجر";
  return "النطاق: " + targets.map((target) => {
    const kind = target.targetKind === "PRODUCT" ? "منتج" : "فئة";
    return `${kind}: ${target.targetLabelAr?.trim() || "هدف كتالوج"}`;
  }).join("، ");
}

function campaignDecisionLabel(campaign: PartnerCampaignView): string {
  if (!requiresPartnerOptIn(campaign.promotion)) return "لا تحتاج موافقة المتجر";
  if (campaign.storeOptInState === "OPTED_IN") return "المتجر مشارك";
  if (campaign.storeOptInState === "DECLINED") return "المتجر رفض المشاركة";
  return "بانتظار قرار المتجر";
}

export function StorePromotionsCard({ storeID, verticalID }: Readonly<{ storeID: string; verticalID: string }>) {
  const theme = useAppearanceTheme();
  const styles = useMemo(() => createStyles(theme), [theme]);
  const authenticated = currentIdentityState().kind === "authenticated";
  const [state, setState] = useState<OperatorPromotionRegistryResponse | null>(null);
  const [campaigns, setCampaigns] = useState<PartnerCampaignListResponse | null>(null);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);
  const [formOpen, setFormOpen] = useState(false);
  const [code, setCode] = useState("");
  const [nameAr, setNameAr] = useState("");
  const [descriptionAr, setDescriptionAr] = useState("");
  const [kind, setKind] = useState<"PERCENTAGE" | "FIXED">("PERCENTAGE");
  const [value, setValue] = useState("");
  const [maxDiscount, setMaxDiscount] = useState("");
  const [redemptionLimit, setRedemptionLimit] = useState("");
  const [minOrderSubtotal, setMinOrderSubtotal] = useState("");
  const [startsAt, setStartsAt] = useState("");
  const [endsAt, setEndsAt] = useState("");
  const [targetKind, setTargetKind] = useState<TargetKind>("NONE");
  const [targetQuery, setTargetQuery] = useState("");
  const [targetOptions, setTargetOptions] = useState<ReadonlyArray<TargetOption>>([]);
  const [selectedTarget, setSelectedTarget] = useState<TargetOption | null>(null);
  const [targetLoading, setTargetLoading] = useState(false);
  const [endingPromotion, setEndingPromotion] = useState<PromotionView | null>(null);

  const load = useCallback(async (): Promise<Readonly<{ promotions: OperatorPromotionRegistryResponse; campaigns: PartnerCampaignListResponse }> | null> => {
    if (!authenticated || !storeID) return null;
    try {
      const token = await getUsableIdentityAccessToken();
      const [next, nextCampaigns] = await Promise.all([
        client().listPartnerStorePromotions(token, storeID),
        client().listPartnerStoreCampaigns(token, storeID),
      ]);
      setState(next);
      setCampaigns(nextCampaigns);
      setError("");
      return { promotions: next, campaigns: nextCampaigns };
    } catch (cause) {
      console.error("DSH store promotions readback failed", cause);
      setError("تعذر قراءة عروض المتجر وحملات المنصة.");
      return null;
    }
  }, [authenticated, storeID]);
  useEffect(() => { void load(); }, [load]);

  function resetForm() {
    setCode(""); setNameAr(""); setDescriptionAr(""); setKind("PERCENTAGE"); setValue(""); setMaxDiscount("");
    setRedemptionLimit(""); setMinOrderSubtotal(""); setStartsAt(""); setEndsAt(""); setTargetKind("NONE");
    setTargetQuery(""); setTargetOptions([]); setSelectedTarget(null);
  }

  const searchTargets = async () => {
    if (targetKind === "NONE") return;
    if (!verticalID) { setError("لا يمكن قراءة أهداف العرض لأن مجال المتجر غير متاح."); return; }
    if (targetQuery.trim().length < 2) { setError("اكتب حرفين على الأقل للبحث عن منتج أو فئة."); return; }
    setTargetLoading(true); setError("");
    try {
      const dsh = client();
      if (targetKind === "PRODUCT") {
        const token = await getUsableIdentityAccessToken();
        const page = await dsh.listCatalogProducts(token, targetQuery.trim(), verticalID, 25);
        setTargetOptions(page.products.map((product: CatalogProduct) => ({ id: product.id, label: product.canonicalName })));
      } else {
        const page = await dsh.listCatalogCategories(verticalID, targetQuery.trim(), 25);
        setTargetOptions(page.categories.map((category: CatalogCategoryListItem) => ({ id: category.id, label: category.pathAr })));
      }
    } catch (cause) {
      console.error("DSH promotion target search failed", cause);
      setTargetOptions([]);
      setError("تعذر البحث في أهداف العرض.");
    } finally { setTargetLoading(false); }
  };

  const create = async () => {
    setBusy(true); setError(""); setNotice("");
    try {
      const token = await getUsableIdentityAccessToken();
      const parsedValue = Number(value);
      const start = parseDate(startsAt, true);
      const end = parseDate(endsAt);
      const max = optionalPositiveInt(maxDiscount);
      const limit = optionalPositiveInt(redemptionLimit);
      const threshold = optionalPositiveInt(minOrderSubtotal);
      if (!start || !code.trim() || code.trim().length < 3 || !nameAr.trim() || nameAr.trim().length < 2 || !Number.isSafeInteger(parsedValue) || parsedValue <= 0 || (kind === "PERCENTAGE" && parsedValue > 100) || (end && end.getTime() <= start.getTime()) || (targetKind !== "NONE" && !selectedTarget)) throw new Error("INVALID_FORM");
      const targets: PromotionTarget[] = selectedTarget && targetKind !== "NONE" ? [{ targetKind, targetRef: selectedTarget.id }] : [];
      const created = await client().createPartnerStorePromotion(token, storeID, {
        id: "promotion-" + Crypto.randomUUID(), code, nameAr,
        ...(descriptionAr.trim() ? { descriptionAr: descriptionAr.trim() } : {}),
        kind, valueMinor: parsedValue, fundingSource: "PARTNER", startsAt: start.toISOString(),
        ...(end ? { endsAt: end.toISOString() } : {}),
        ...(max ? { maxDiscountMinor: max } : {}),
        ...(limit ? { redemptionLimit: limit } : {}),
        ...(threshold ? { minOrderSubtotalMinor: threshold } : {}),
        ...(targets.length ? { targets } : {}),
      }, "promotion_create_" + Crypto.randomUUID(), "promotion_create_corr_" + Crypto.randomUUID());
      const readback = await load();
      const canonical = readback?.promotions.promotions.find((promotion) => promotion.id === created.promotion.id);
      if (!canonical || canonical.state !== "DRAFT") {
        setError("تم إرسال إنشاء العرض لكن تعذّر إثبات المسودة من القراءة المعتمدة. أعد القراءة قبل أي إجراء آخر.");
        return;
      }
      setNotice("أُنشئ العرض كمسودة وتم تأكيده من القراءة المعتمدة؛ راجع نطاقه وجدوله ثم انشره.");
      setFormOpen(false); resetForm();
    } catch (cause) {
      console.error("DSH promotion create failed", cause);
      setError(cause instanceof Error && cause.message === "INVALID_FORM" ? "راجع رمز العرض والاسم والقيمة والفترة وحد الطلب والهدف المختار." : "تعذر إنشاء العرض؛ راجع البيانات وأعد المحاولة.");
    } finally { setBusy(false); }
  };

  const transition = async (promotion: PromotionView, target: "PUBLISHED" | "PAUSED" | "ENDED") => {
    setBusy(true); setError(""); setNotice("");
    try {
      const token = await getUsableIdentityAccessToken();
      await client().setPartnerStorePromotionState(token, storeID, promotion.id, { state: target }, promotion.version, "promotion_state_" + Crypto.randomUUID(), "promotion_state_corr_" + Crypto.randomUUID());
      const readback = await load();
      const canonical = readback?.promotions.promotions.find((item) => item.id === promotion.id);
      if (!canonical || canonical.state !== target) {
        setError("تم إرسال تغيير الحالة لكن تعذّر إثبات النتيجة من القراءة المعتمدة. اعتمد الحالة المعروضة بعد إعادة القراءة.");
        return;
      }
      setNotice(target === "ENDED" ? "أُنهي العرض وتم تأكيد حالته من القراءة المعتمدة." : target === "PAUSED" ? "أُوقف العرض وتم تأكيد حالته من القراءة المعتمدة." : "نُشر العرض وتم تأكيد حالته من القراءة المعتمدة.");
    } catch (cause) {
      console.error("DSH promotion state change failed", cause);
      setError("تعذر تحديث حالة العرض؛ أعد القراءة ثم حاول مجددًا."); await load();
    } finally { setBusy(false); }
  };

  const decideCampaign = async (campaign: PartnerCampaignView, decision: "OPTED_IN" | "DECLINED") => {
    setBusy(true); setError(""); setNotice("");
    try {
      const token = await getUsableIdentityAccessToken();
      await client().optInPartnerStoreCampaign(token, storeID, campaign.promotion.id, { decision }, Math.max(1, campaign.storeOptInVersion ?? 0));
      const readback = await load();
      const canonical = readback?.campaigns.campaigns.find((item) => item.promotion.id === campaign.promotion.id);
      if (!canonical || canonical.storeOptInState !== decision) {
        setError("تم إرسال قرار الحملة لكن تعذّر إثباته من القراءة المعتمدة. أعد القراءة قبل اتخاذ قرار آخر.");
        return;
      }
      setNotice(decision === "OPTED_IN" ? "سُجّلت مشاركة المتجر وتم تأكيدها من القراءة المعتمدة." : "سُجّل رفض المشاركة وتم تأكيده من القراءة المعتمدة.");
    } catch (cause) {
      console.error("DSH campaign opt-in failed", cause);
      setError("تعذر تحديث قرار الحملة؛ أعد قراءة الحملات ثم حاول مجددًا."); await load();
    } finally { setBusy(false); }
  };

  if (!authenticated) return null;
  const now = Date.now();
  const buckets: Record<"active" | "scheduled" | "ended", PromotionView[]> = { active: [], scheduled: [], ended: [] };
  for (const promotion of state?.promotions ?? []) buckets[lifecycleBucket(promotion, now)].push(promotion);

  return <BthwaniSurface style={styles.card}>
    <View style={styles.header}><Text style={styles.title}>العروض والحملات</Text><BthwaniButton label={formOpen ? "إغلاق" : "عرض جديد"} onPress={() => { setFormOpen((open) => !open); setError(""); }} variant="secondary" /></View>
    <Text style={styles.muted}>عروض المتجر يمولها الشريك. تحدد المنصة تمويل حملاتها وشروط المشاركة.</Text>
    {notice ? <Text style={styles.notice}>{notice}</Text> : null}
    {error ? <Text accessibilityRole="alert" style={styles.error}>{error}</Text> : null}
    {!state && !campaigns && !error ? <View style={styles.loading}><ActivityIndicator accessibilityLabel="جارٍ قراءة العروض والحملات" color={theme.interactiveText} /></View> : null}

    {state && formOpen ? <View style={styles.form}>
      <Text style={styles.formTitle}>عرض متجر جديد</Text>
      <TextInput accessibilityLabel="رمز العرض" autoCapitalize="characters" placeholder="رمز قصير بالإنجليزية" placeholderTextColor={theme.colorMuted} style={styles.input} value={code} onChangeText={setCode} />
      <TextInput accessibilityLabel="اسم العرض" placeholder="اسم العرض" placeholderTextColor={theme.colorMuted} style={styles.input} value={nameAr} onChangeText={setNameAr} />
      <TextInput accessibilityLabel="وصف العرض" multiline placeholder="وصف مختصر (اختياري)" placeholderTextColor={theme.colorMuted} style={styles.input} value={descriptionAr} onChangeText={setDescriptionAr} />
      <View style={styles.kindRow}><BthwaniChip label="نسبة %" onPress={() => setKind("PERCENTAGE")} selected={kind === "PERCENTAGE"} /><BthwaniChip label="مبلغ ثابت" onPress={() => setKind("FIXED")} selected={kind === "FIXED"} /></View>
      <TextInput accessibilityLabel="قيمة الخصم" keyboardType="number-pad" placeholder={kind === "PERCENTAGE" ? "نسبة الخصم (1-100)" : "قيمة الخصم بالريال اليمني"} placeholderTextColor={theme.colorMuted} style={styles.input} value={value} onChangeText={setValue} />
      {kind === "PERCENTAGE" ? <TextInput accessibilityLabel="أقصى خصم" keyboardType="number-pad" placeholder="أقصى خصم بالريال اليمني (اختياري)" placeholderTextColor={theme.colorMuted} style={styles.input} value={maxDiscount} onChangeText={setMaxDiscount} /> : null}
      <TextInput accessibilityLabel="حد الطلب الأدنى" keyboardType="number-pad" placeholder="حد الطلب الأدنى بالريال اليمني (اختياري)" placeholderTextColor={theme.colorMuted} style={styles.input} value={minOrderSubtotal} onChangeText={setMinOrderSubtotal} />
      <TextInput accessibilityLabel="حد الاستخدام" keyboardType="number-pad" placeholder="حد الاستخدام الكلي (اختياري)" placeholderTextColor={theme.colorMuted} style={styles.input} value={redemptionLimit} onChangeText={setRedemptionLimit} />
      <TextInput accessibilityLabel="بداية العرض بتوقيت اليمن" autoCapitalize="none" placeholder="يوم/شهر/سنة ساعة:دقيقة، فارغ = الآن" placeholderTextColor={theme.colorMuted} style={styles.input} value={startsAt} onChangeText={setStartsAt} />
      <TextInput accessibilityLabel="نهاية العرض بتوقيت اليمن" autoCapitalize="none" placeholder="يوم/شهر/سنة ساعة:دقيقة (اختياري)" placeholderTextColor={theme.colorMuted} style={styles.input} value={endsAt} onChangeText={setEndsAt} />
      <Text style={styles.formTitle}>نطاق الخصم</Text>
      <View style={styles.kindRow}>
        <BthwaniChip label="كل المتجر" onPress={() => { setTargetKind("NONE"); setSelectedTarget(null); setTargetOptions([]); }} selected={targetKind === "NONE"} />
        <BthwaniChip label="منتج" onPress={() => { setTargetKind("PRODUCT"); setSelectedTarget(null); setTargetOptions([]); }} selected={targetKind === "PRODUCT"} />
        <BthwaniChip label="فئة" onPress={() => { setTargetKind("CATEGORY"); setSelectedTarget(null); setTargetOptions([]); }} selected={targetKind === "CATEGORY"} />
      </View>
      {targetKind !== "NONE" ? <>
        <View style={styles.searchRow}><TextInput accessibilityLabel="بحث هدف العرض" placeholder={targetKind === "PRODUCT" ? "ابحث باسم المنتج" : "ابحث باسم الفئة"} placeholderTextColor={theme.colorMuted} style={[styles.input, styles.searchInput]} value={targetQuery} onChangeText={setTargetQuery} /><BthwaniButton busy={targetLoading} disabled={targetLoading || targetQuery.trim().length < 2} label="بحث" onPress={() => void searchTargets()} variant="secondary" /></View>
        {selectedTarget ? <Text style={styles.notice}>الهدف المختار: {selectedTarget.label}</Text> : null}
        {targetOptions.map((option) => <BthwaniChip key={option.id} label={option.label} onPress={() => setSelectedTarget(option)} selected={selectedTarget?.id === option.id} />)}
      </> : null}
      <BthwaniButton busy={busy} label="إنشاء مسودة العرض" onPress={() => void create()} />
    </View> : null}

    <View style={styles.section}>
      <Text style={styles.sectionTitle}>عروض المتجر</Text>
      {state && state.promotions.length === 0 && !formOpen ? <Text style={styles.muted}>لا توجد عروض متجر بعد.</Text> : null}
      <ScrollView style={styles.list}>{(["active", "scheduled", "ended"] as const).map((bucket) => buckets[bucket].length === 0 ? null : <View key={bucket} style={styles.bucket}>
        <Text style={styles.bucketTitle}>{bucket === "active" ? "نشطة" : bucket === "scheduled" ? "مجدولة أو موقوفة" : "منتهية"}</Text>
        {buckets[bucket].map((promotion) => { const threshold = minOrderSubtotalMinor(promotion); return <View key={promotion.id} style={styles.row}><View style={styles.rowCopy}>
          <Text style={styles.promoName}>{promotion.nameAr} · {promotion.code}</Text><Text style={styles.muted}>{benefitLabel(promotion)} · {fundingLabel(promotion)}</Text>
          <Text style={styles.muted}>{promotionScopeLabel(promotion)}</Text>
          {threshold ? <Text style={styles.muted}>حد الطلب: {formatMoney(threshold, "YER")}</Text> : null}
          <Text style={styles.muted}>من {new Date(promotion.startsAt).toLocaleString("ar-YE")}{promotion.endsAt ? " إلى " + new Date(promotion.endsAt).toLocaleString("ar-YE") : ""}</Text>
        </View><View style={styles.actions}>
          {promotion.state === "DRAFT" ? <BthwaniButton busy={busy} label="نشر" onPress={() => void transition(promotion, "PUBLISHED")} variant="secondary" /> : null}
          {promotion.state === "PUBLISHED" ? <BthwaniButton busy={busy} label="إيقاف" onPress={() => void transition(promotion, "PAUSED")} variant="secondary" /> : null}
          {promotion.state === "PAUSED" ? <BthwaniButton busy={busy} label="استئناف" onPress={() => void transition(promotion, "PUBLISHED")} variant="secondary" /> : null}
          {promotion.state !== "ENDED" ? <BthwaniButton busy={busy} label="إنهاء" onPress={() => setEndingPromotion(promotion)} variant="secondary" /> : null}
        </View></View>; })}
      </View>)}</ScrollView>
    </View>

    <View style={styles.section}><Text style={styles.sectionTitle}>حملات المنصة المؤهلة</Text>
      {campaigns && campaigns.campaigns.length === 0 ? <Text style={styles.muted}>لا توجد حملات منصة مؤهلة لهذا المتجر الآن.</Text> : null}
      {(campaigns?.campaigns ?? []).map((campaign) => { const threshold = minOrderSubtotalMinor(campaign.promotion); return <View key={campaign.promotion.id} style={styles.row}><View style={styles.rowCopy}>
        <Text style={styles.promoName}>{campaign.promotion.nameAr}</Text><Text style={styles.muted}>{benefitLabel(campaign.promotion)} · {fundingLabel(campaign.promotion)}</Text>
        <Text style={styles.muted}>{promotionScopeLabel(campaign.promotion)}</Text>
        {threshold ? <Text style={styles.muted}>حد الطلب: {formatMoney(threshold, "YER")}</Text> : null}
        <Text style={campaign.storeOptInState === "OPTED_IN" ? styles.notice : styles.muted}>{campaignDecisionLabel(campaign)}</Text>
      </View>{requiresPartnerOptIn(campaign.promotion) ? <View style={styles.actions}>
        <BthwaniButton busy={busy} disabled={campaign.storeOptInState === "OPTED_IN"} label="مشاركة" onPress={() => void decideCampaign(campaign, "OPTED_IN")} variant="secondary" />
        <BthwaniButton busy={busy} disabled={campaign.storeOptInState === "DECLINED"} label="رفض" onPress={() => void decideCampaign(campaign, "DECLINED")} variant="secondary" />
      </View> : null}</View>; })}
    </View>
    <BthwaniConfirmDialog
      busy={busy}
      confirmLabel="إنهاء العرض"
      description={endingPromotion ? `سيُنهي هذا العرض «${endingPromotion.nameAr}» نهائيًا. لا يمكن استئنافه بعد انتقاله إلى الحالة المنتهية.` : ""}
      intent="danger"
      onCancel={() => setEndingPromotion(null)}
      onConfirm={() => {
        const promotion = endingPromotion;
        setEndingPromotion(null);
        if (promotion) void transition(promotion, "ENDED");
      }}
      title="تأكيد إنهاء العرض"
      visible={Boolean(endingPromotion)}
    />
  </BthwaniSurface>;
}

function createStyles(theme: ReturnType<typeof resolveTheme>) {
  return StyleSheet.create({
    card: { borderColor: theme.borderColor, borderRadius: radius.lg, borderWidth: borders.hairline, gap: spacing[4], padding: spacing[4] },
    header: { alignItems: "center", flexDirection: "row", gap: spacing[3], justifyContent: "space-between" },
    title: { ...typography.titleSm, color: theme.color }, section: { gap: spacing[3] }, sectionTitle: { ...typography.titleSm, color: theme.color },
    formTitle: { ...typography.label, color: theme.color }, muted: { ...typography.bodySm, color: theme.colorMuted }, notice: { ...typography.bodySm, color: theme.interactiveText },
    error: { ...typography.bodySm, color: theme.warning }, loading: { alignItems: "center", padding: spacing[3] },
    form: { borderColor: theme.borderColor, borderRadius: radius.md, borderWidth: borders.hairline, gap: spacing[2], padding: spacing[3] },
    input: { ...typography.bodySm, borderColor: theme.borderColor, borderRadius: radius.md, borderWidth: borders.hairline, color: theme.color, padding: spacing[3], textAlign: "left" },
    kindRow: { flexDirection: "row", flexWrap: "wrap", gap: spacing[2] }, searchRow: { alignItems: "center", flexDirection: "row", gap: spacing[2] }, searchInput: { flex: 1 },
    list: { maxHeight: 520 }, bucket: { gap: spacing[2], marginBottom: spacing[3] }, bucketTitle: { ...typography.label, color: theme.interactiveText },
    row: { alignItems: "flex-start", borderColor: theme.borderColor, borderRadius: radius.md, borderWidth: borders.hairline, flexDirection: "row", gap: spacing[2], justifyContent: "space-between", padding: spacing[3] },
    rowCopy: { flex: 1, gap: spacing[1] }, actions: { gap: spacing[1] }, promoName: { ...typography.bodySm, color: theme.color },
  });
}
