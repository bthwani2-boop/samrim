import { borders, radius, resolveTheme, spacing, typography } from "@bthwani/design-system";
import { BthwaniButton, BthwaniSurface, useAppearanceTheme } from "@bthwani/design-system/native";
import { createDshMobileClient, type OperatorPromotionRegistryResponse, type PromotionView } from "@bthwani/dsh";
import * as Crypto from "expo-crypto";
import { useCallback, useEffect, useMemo, useState } from "react";
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
import { currentIdentityState, getUsableIdentityAccessToken } from "../../bootstrap/identity";

function client() {
  const baseUrl = process.env.EXPO_PUBLIC_DSH_API_URL?.trim();
  if (!baseUrl) throw new Error("DSH_BASE_URL_REQUIRED");
  return createDshMobileClient(baseUrl, { cryptoRandomUUID: () => Crypto.randomUUID() });
}

function lifecycleBucket(promotion: PromotionView, now: number): "active" | "scheduled" | "ended" {
  if (promotion.state === "ENDED") return "ended";
  if (promotion.state === "DRAFT") return "scheduled";
  if (promotion.state === "PAUSED") return "scheduled";
  const start = Date.parse(promotion.startsAt);
  const end = promotion.endsAt ? Date.parse(promotion.endsAt) : Number.POSITIVE_INFINITY;
  if (now >= start && now < end) return "active";
  if (now < start) return "scheduled";
  return "ended";
}

function benefitLabel(promotion: PromotionView): string {
  return promotion.kind === "PERCENTAGE" ? `خصم ${promotion.valueMinor}%` : `خصم ${(promotion.valueMinor / 100).toLocaleString("ar")} ريال`;
}

export function StorePromotionsCard({ storeID, owned }: Readonly<{ storeID: string; owned: boolean }>) {
  const theme = useAppearanceTheme();
  const styles = useMemo(() => createStyles(theme), [theme]);
  const authenticated = currentIdentityState().kind === "authenticated";
  const [state, setState] = useState<OperatorPromotionRegistryResponse | null>(null);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);
  const [formOpen, setFormOpen] = useState(false);
  const [code, setCode] = useState("");
  const [nameAr, setNameAr] = useState("");
  const [kind, setKind] = useState<"PERCENTAGE" | "FIXED">("PERCENTAGE");
  const [value, setValue] = useState("");
  const [maxDiscount, setMaxDiscount] = useState("");
  const [redemptionLimit, setRedemptionLimit] = useState("");

  const load = useCallback(async () => {
    if (!authenticated || !storeID) return;
    try {
      const token = await getUsableIdentityAccessToken();
      const next = await client().listPartnerStorePromotions(token, storeID);
      setState(next);
      setError("");
    } catch (cause) {
      console.error("DSH store promotions readback failed", cause);
      setError("تعذر قراءة عروض المتجر.");
    }
  }, [authenticated, storeID]);
  useEffect(() => { void load(); }, [load]);

  const create = async () => {
    setBusy(true); setError(""); setNotice("");
    try {
      const token = await getUsableIdentityAccessToken();
      const parsedValue = Number(value);
      if (!code.trim() || !nameAr.trim() || !Number.isSafeInteger(parsedValue) || parsedValue <= 0 || (kind === "PERCENTAGE" && parsedValue > 100)) throw new Error("INVALID_FORM");
      await client().createPartnerStorePromotion(token, storeID, {
        id: "promotion-" + Crypto.randomUUID(),
        code: code,
        nameAr: nameAr,
        kind,
        valueMinor: parsedValue,
        fundingSource: "PARTNER",
        startsAt: new Date().toISOString(),
        ...(maxDiscount ? { maxDiscountMinor: Number(maxDiscount) } : {}),
        ...(redemptionLimit ? { redemptionLimit: Number(redemptionLimit) } : {}),
      }, `promotion_create_${Crypto.randomUUID()}`, `promotion_create_corr_${Crypto.randomUUID()}`);
      setNotice("أُنشئ العرض كمسودة؛ انشره ليظهر للعملاء.");
      setFormOpen(false); setCode(""); setNameAr(""); setValue(""); setMaxDiscount(""); setRedemptionLimit("");
      await load();
    } catch (cause) {
      console.error("DSH promotion create failed", cause);
      setError(cause instanceof Error && cause.message === "INVALID_FORM" ? "أكمل بيانات العرض: رمز من 3 أحرف على الأقل، اسم، وقيمة صحيحة." : "تعذر إنشاء العرض؛ راجع البيانات وأعد المحاولة.");
    } finally { setBusy(false); }
  };

  const transition = async (promotion: PromotionView, target: "PUBLISHED" | "PAUSED" | "ENDED") => {
    setBusy(true); setError(""); setNotice("");
    try {
      const token = await getUsableIdentityAccessToken();
      await client().setPartnerStorePromotionState(token, storeID, promotion.id, { state: target }, promotion.version, `promotion_state_${Crypto.randomUUID()}`, `promotion_state_corr_${Crypto.randomUUID()}`);
      setNotice("حدّثت حالة العرض.");
      await load();
    } catch (cause) {
      console.error("DSH promotion state change failed", cause);
      setError("تعذر تحديث حالة العرض؛ أعد القراءة ثم حاول مجددًا.");
      await load();
    } finally { setBusy(false); }
  };

  if (!authenticated || !owned) return null;
  const now = Date.now();
  const buckets: Record<"active" | "scheduled" | "ended", PromotionView[]> = { active: [], scheduled: [], ended: [] };
  for (const promotion of state?.promotions ?? []) buckets[lifecycleBucket(promotion, now)].push(promotion);
  return <BthwaniSurface style={styles.card}>
    <View style={styles.header}>
      <Text style={styles.title}>العروض</Text>
      <BthwaniButton label="عرض جديد" onPress={() => setFormOpen((open) => !open)} variant="secondary" />
    </View>
    <Text style={styles.muted}>خصومات المتجر الممولة من الشريك؛ يجمد كل طلب نسخة العرض وقيمته عند الشراء.</Text>
    {notice ? <Text style={styles.notice}>{notice}</Text> : null}
    {error ? <Text style={styles.error}>{error}</Text> : null}
    {!state && !error ? <View style={styles.loading}><ActivityIndicator accessibilityLabel="جارٍ قراءة العروض" color={theme.interactiveText} /></View> : null}
    {state && formOpen ? <View style={styles.form}>
      <TextInput accessibilityLabel="رمز العرض" autoCapitalize="characters" placeholder="رمز العرض (إنجليزي)" placeholderTextColor={theme.colorMuted} style={styles.input} value={code} onChangeText={setCode} />
      <TextInput accessibilityLabel="اسم العرض" placeholder="اسم العرض" placeholderTextColor={theme.colorMuted} style={styles.input} value={nameAr} onChangeText={setNameAr} />
      <View style={styles.kindRow}>
        {(["PERCENTAGE", "FIXED"] as const).map((candidate) => <Pressable accessibilityRole="button" key={candidate} onPress={() => setKind(candidate)} style={[styles.kindChip, kind === candidate ? styles.kindChipActive : null]}>
          <Text style={styles.kindText}>{candidate === "PERCENTAGE" ? "نسبة %" : "مبلغ ثابت"}</Text>
        </Pressable>)}
      </View>
      <TextInput accessibilityLabel="قيمة الخصم" keyboardType="number-pad" placeholder={kind === "PERCENTAGE" ? "نسبة الخصم (1-100)" : "قيمة الخصم بالهللات"} placeholderTextColor={theme.colorMuted} style={styles.input} value={value} onChangeText={setValue} />
      <TextInput accessibilityLabel="أقصى خصم" keyboardType="number-pad" placeholder="أقصى خصم بالهللات (اختياري)" placeholderTextColor={theme.colorMuted} style={styles.input} value={maxDiscount} onChangeText={setMaxDiscount} />
      <TextInput accessibilityLabel="حد الاستخدام" keyboardType="number-pad" placeholder="حد الاستخدام الكلي (اختياري)" placeholderTextColor={theme.colorMuted} style={styles.input} value={redemptionLimit} onChangeText={setRedemptionLimit} />
      <BthwaniButton busy={busy} label="إنشاء العرض" onPress={() => void create()} />
    </View> : null}
    {state && state.promotions.length === 0 && !formOpen ? <Text style={styles.muted}>لا توجد عروض بعد.</Text> : null}
    <ScrollView style={styles.list}>
      {(["active", "scheduled", "ended"] as const).map((bucket) => buckets[bucket].length === 0 ? null : <View key={bucket} style={styles.bucket}>
        <Text style={styles.bucketTitle}>{bucket === "active" ? "نشطة" : bucket === "scheduled" ? "مجدولة" : "منتهية"}</Text>
        {buckets[bucket].map((promotion) => <View key={promotion.id} style={styles.row}>
          <View style={styles.rowCopy}>
            <Text style={styles.promoName}>{promotion.nameAr} · {promotion.code}</Text>
            <Text style={styles.muted}>{benefitLabel(promotion)}{promotion.state === "PAUSED" ? " · موقوف مؤقتًا" : ""}</Text>
          </View>
          {promotion.state === "DRAFT" ? <BthwaniButton busy={busy} label="نشر" onPress={() => void transition(promotion, "PUBLISHED")} variant="secondary" /> : null}
          {promotion.state === "PUBLISHED" ? <BthwaniButton busy={busy} label="إيقاف" onPress={() => void transition(promotion, "PAUSED")} variant="secondary" /> : null}
          {promotion.state === "PAUSED" ? <BthwaniButton busy={busy} label="استئناف" onPress={() => void transition(promotion, "PUBLISHED")} variant="secondary" /> : null}
          {promotion.state !== "ENDED" ? <BthwaniButton busy={busy} label="إنهاء" onPress={() => void transition(promotion, "ENDED")} variant="secondary" /> : null}
        </View>)}
      </View>)}
    </ScrollView>
  </BthwaniSurface>;
}

function createStyles(theme: ReturnType<typeof resolveTheme>) {
  return StyleSheet.create({
    card: { borderColor: theme.borderColor, borderRadius: radius.lg, borderWidth: borders.hairline, gap: spacing[3], padding: spacing[4] },
    header: { alignItems: "center", flexDirection: "row", gap: spacing[3], justifyContent: "space-between" },
    title: { ...typography.titleSm, color: theme.color },
    muted: { ...typography.bodySm, color: theme.colorMuted },
    notice: { ...typography.bodySm, color: theme.interactiveText },
    error: { ...typography.bodySm, color: theme.warning },
    loading: { alignItems: "center", padding: spacing[3] },
    form: { borderColor: theme.borderColor, borderRadius: radius.md, borderWidth: borders.hairline, gap: spacing[2], padding: spacing[3] },
    input: { ...typography.bodySm, borderColor: theme.borderColor, borderRadius: radius.md, borderWidth: borders.hairline, color: theme.color, padding: spacing[3], textAlign: "left" },
    kindRow: { flexDirection: "row", gap: spacing[2] },
    kindChip: { alignItems: "center", borderColor: theme.borderColor, borderRadius: radius.sm, borderWidth: borders.hairline, flex: 1, padding: spacing[2] },
    kindChipActive: { backgroundColor: theme.surfaceInset },
    kindText: { ...typography.bodySm, color: theme.color },
    list: { maxHeight: 420 },
    bucket: { gap: spacing[2], marginBottom: spacing[3] },
    bucketTitle: { ...typography.label, color: theme.interactiveText },
    row: { alignItems: "flex-start", borderColor: theme.borderColor, borderRadius: radius.md, borderWidth: borders.hairline, flexDirection: "row", gap: spacing[2], justifyContent: "space-between", padding: spacing[3] },
    rowCopy: { flex: 1, gap: spacing[1] },
    promoName: { ...typography.bodySm, color: theme.color },
  });
}
