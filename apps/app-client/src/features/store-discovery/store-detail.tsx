import { borders, direction, radius, resolveTextAlign, type resolveTheme, sizing, spacing, toAsciiDigits, typography } from "@bthwani/design-system";
import { useAppearanceTheme } from "@bthwani/design-system/native";
import { formatMoney, type PublicCatalogResponse, type PublicStoreView } from "@bthwani/dsh";
import { type Href, useRouter } from "expo-router";
import { useCallback, useEffect, useMemo, useState } from "react";
import { ActivityIndicator, Pressable, StyleSheet, Text, TextInput, View } from "react-native";
import { currentIdentityState } from "../../bootstrap/identity";
import { useServiceCityScope } from "../service-city/service-city-scope";
import { addCatalogOfferToCart, readPublicStoreCatalog, readPublishedStore } from "./store-discovery-client";

type DetailState =
  | { kind: "loading" }
  | { kind: "ready"; store: PublicStoreView; catalog: PublicCatalogResponse }
  | { kind: "error" };

export default function ClientStoreDetail({ storeId }: { storeId: string }) {
  const router = useRouter();
  const { selectedCityID } = useServiceCityScope();
  const theme = useAppearanceTheme();
  const styles = useMemo(() => createStyles(theme), [theme]);
  const [state, setState] = useState<DetailState>({ kind: "loading" });
  const [quantities, setQuantities] = useState<Record<string, string>>({});
  const [selectedModifierOptionIds, setSelectedModifierOptionIds] = useState<Record<string, ReadonlyArray<string>>>({});
  const [busyOfferId, setBusyOfferId] = useState("");
  const [addedOfferId, setAddedOfferId] = useState("");
  const [error, setError] = useState("");
  const mutationBusy = Boolean(busyOfferId);

  const load = useCallback(async () => {
    if (!storeId.trim() || !selectedCityID) {
      setState({ kind: "error" });
      return;
    }
    setState({ kind: "loading" });
    try {
      const [store, catalog] = await Promise.all([readPublishedStore(storeId, selectedCityID), readPublicStoreCatalog(storeId, selectedCityID)]);
      setState({ kind: "ready", store, catalog });
    } catch {
      setState({ kind: "error" });
    }
  }, [selectedCityID, storeId]);

  useEffect(() => { void load(); }, [load]);

  if (state.kind === "loading") {
    return <View style={styles.state}><ActivityIndicator accessibilityLabel="جارٍ فتح المتجر" color={theme.actionBackground} /><Text style={styles.muted}>جارٍ قراءة كتالوج المتجر…</Text></View>;
  }
  if (state.kind === "error") {
    return <View style={styles.state}><Text style={styles.title}>تعذر قراءة المتجر</Text><Text style={styles.muted}>قد لا يكون المتجر متاحًا في مدينة الخدمة الحالية.</Text><Pressable accessibilityRole="button" onPress={() => void load()} style={styles.button}><Text style={styles.buttonText}>إعادة المحاولة</Text></Pressable><Pressable accessibilityRole="button" onPress={() => router.back()} style={styles.secondaryButton}><Text style={styles.secondaryButtonText}>العودة</Text></Pressable></View>;
  }

  const sectionOfferIds = new Set(state.catalog.sections.flatMap((section) => section.offerIds));
  function toggleModifier(offer: PublicCatalogResponse["offers"][number], groupId: string, optionId: string, maxSelections: number) {
    if (mutationBusy) return;
    setSelectedModifierOptionIds((current) => {
      const selected = [...(current[offer.offerId] ?? [])];
      const optionIndex = selected.indexOf(optionId);
      const groupOptionIds = new Set(offer.modifierGroups.find((group) => group.id === groupId)?.options.map((item) => item.id) ?? []);
      if (optionIndex >= 0) {
        selected.splice(optionIndex, 1);
      } else {
        const withoutGroup = selected.filter((id) => !groupOptionIds.has(id));
        if (maxSelections === 1) selected.splice(0, selected.length, ...withoutGroup, optionId);
        else if (selected.filter((id) => groupOptionIds.has(id)).length < maxSelections) selected.push(optionId);
      }
      return { ...current, [offer.offerId]: selected };
    });
  }

  async function add(offer: PublicCatalogResponse["offers"][number]) {
    if (busyOfferId) return;
    if (currentIdentityState().kind !== "authenticated") {
      router.replace(`/?returnTo=/store/${encodeURIComponent(storeId)}` as Href);
      return;
    }
    const quantity = Number(quantities[offer.offerId] ?? String(offer.quantityMinBaseUnits));
    if (!Number.isSafeInteger(quantity) || !isQuantityAllowed(offer, quantity)) {
      setError("الكمية لا تطابق الحد الأدنى أو الأقصى أو خطوة الكمية لهذا العرض.");
      return;
    }
    const modifierError = validateModifierSelection(offer, selectedModifierOptionIds[offer.offerId] ?? []);
    if (modifierError) {
      setError(modifierError);
      return;
    }
    setBusyOfferId(offer.offerId);
    setAddedOfferId("");
    setError("");
    try {
      await addCatalogOfferToCart(storeId, offer, quantity, selectedModifierOptionIds[offer.offerId] ?? []);
      setAddedOfferId(offer.offerId);
    } catch (cause) {
      console.error("DSH catalog offer add failed", cause);
      setError(dshMutationErrorMessage(cause, "تعذر إضافة المنتج. أعد المحاولة أو افتح السلة لقراءة حالتها."));
    } finally {
      setBusyOfferId("");
    }
  }

  const renderOffer = (offer: PublicCatalogResponse["offers"][number]) => {
    const selectedOptions = selectedModifierOptionIds[offer.offerId] ?? [];
    const quantity = quantities[offer.offerId] ?? String(offer.quantityMinBaseUnits);
    const busy = busyOfferId === offer.offerId;
    const modifierError = validateModifierSelection(offer, selectedOptions);
    return (
      <View key={offer.offerId} style={styles.item}>
        <Text style={styles.itemTitle}>{offer.productName}</Text>
        <Text style={styles.muted}>{formatMoney(offer.priceMinor, offer.currency)} · {offer.measurementKind === "DISCRETE" ? "بالقطعة" : offer.baseUnit === "GRAM" ? "بالغرام" : "بالمليلتر"}</Text>
        <Text style={styles.muted}>الكمية: {formatQuantity(offer.baseUnit, offer.quantityMinBaseUnits)}–{formatQuantity(offer.baseUnit, offer.quantityMaxBaseUnits)} بخطوة {formatQuantity(offer.baseUnit, offer.quantityStepBaseUnits)}</Text>
        <TextInput accessibilityLabel={`كمية ${offer.productName}`} editable={!mutationBusy} keyboardType="number-pad" onChangeText={(value) => setQuantities((current) => ({ ...current, [offer.offerId]: toAsciiDigits(value).replace(/[^0-9]/g, "") }))} value={quantity} style={[styles.quantityInput, mutationBusy && styles.disabledInput]} />
        {offer.modifierGroups.map((group) => {
          const groupError = modifierGroupError(group, selectedOptions);
          return (
            <View key={group.id} style={styles.modifierGroup}>
              <Text style={styles.muted}>{group.nameAr}{group.required ? " · مطلوب" : ""}</Text>
              <View style={styles.modifierOptions}>
                {group.options.filter((option) => option.availability).map((option) => {
                  const selected = selectedOptions.includes(option.id);
                  return <Pressable key={option.id} accessibilityRole="button" accessibilityState={{ selected, disabled: mutationBusy }} accessibilityHint={groupError || undefined} disabled={mutationBusy} onPress={() => toggleModifier(offer, group.id, option.id, group.maxSelections)} style={[styles.modifierOption, selected && styles.modifierOptionSelected, groupError && styles.invalidModifierOption]}><Text style={[styles.secondaryButtonText, selected && styles.selectedOptionText]}>{option.nameAr}{option.priceDeltaMinor ? ` · +${formatMoney(option.priceDeltaMinor, offer.currency)}` : ""}</Text></Pressable>;
                })}
              </View>
              {groupError ? <Text accessibilityLiveRegion="polite" style={styles.validationError}>{groupError}</Text> : null}
            </View>
          );
        })}
        {modifierError ? <Text accessibilityRole="alert" accessibilityLiveRegion="polite" style={styles.validationError}>{modifierError}</Text> : null}
        <Pressable accessibilityRole="button" accessibilityLabel={`إضافة ${offer.productName}`} accessibilityState={{ busy, disabled: mutationBusy || Boolean(modifierError) }} disabled={mutationBusy || Boolean(modifierError)} onPress={() => void add(offer)} style={[styles.button, (mutationBusy || modifierError) && styles.disabledButton]}><Text style={[styles.buttonText, (mutationBusy || modifierError) && styles.disabledButtonText]}>{busy ? "جارٍ الإضافة…" : "إضافة إلى السلة"}</Text></Pressable>
        {addedOfferId === offer.offerId ? <Text accessibilityLiveRegion="polite" style={styles.success}>تمت الإضافة. يمكنك متابعة اختيار المنتجات أو فتح السلة.</Text> : null}
      </View>
    );
  };

  return (
    <View style={styles.container} accessibilityLabel={`كتالوج ${state.store.name}`}>
      <Pressable accessibilityRole="button" accessibilityLabel="العودة إلى المتاجر" onPress={() => router.back()}><Text style={styles.back}>المتاجر المتاحة</Text></Pressable>
      <Text style={styles.eyebrow}>كتالوج المتجر</Text>
      <Text style={styles.title}>{state.store.name}</Text>
      <Text style={styles.muted}>مدينة الخدمة: {state.store.serviceCity.displayNameAr}</Text>
      <Text style={styles.sectionTitle}>المنتجات المتاحة</Text>
      {state.catalog.sections.map((section) => (
        <View key={section.id} style={styles.section}>
          <Text style={styles.sectionTitle}>{section.nameAr}</Text>
          {section.offerIds.map((offerId) => state.catalog.offers.find((offer) => offer.offerId === offerId)).filter((offer): offer is PublicCatalogResponse["offers"][number] => Boolean(offer)).map(renderOffer)}
        </View>
      ))}
      {state.catalog.offers.filter((offer) => !sectionOfferIds.has(offer.offerId)).map(renderOffer)}
      {state.catalog.offers.length === 0 ? <Text style={styles.muted}>لا توجد منتجات متاحة حاليًا.</Text> : null}
      <View style={styles.cartCta}>
        <Text style={styles.muted}>أضف المنتجات واضبط الخيارات هنا، ثم افتح السلة لاختيار العنوان وإتمام الطلب.</Text>
        <Pressable accessibilityRole="button" accessibilityLabel="فتح السلة" accessibilityState={{ disabled: mutationBusy }} disabled={mutationBusy} onPress={() => router.push(`/cart/${encodeURIComponent(storeId)}` as Href)} style={[styles.button, mutationBusy && styles.disabledButton]}><Text style={[styles.buttonText, mutationBusy && styles.disabledButtonText]}>فتح السلة</Text></Pressable>
      </View>
      {error ? <Text accessibilityRole="alert" style={styles.error}>{error}</Text> : null}
    </View>
  );
}

function createStyles(theme: ReturnType<typeof resolveTheme>) {
  const activeDirection = direction.defaultDirection;
  const startTextAlign = resolveTextAlign("start", activeDirection);
  return StyleSheet.create({
    container: { backgroundColor: theme.surface, borderColor: theme.borderColor, borderRadius: radius.md, borderWidth: borders.hairline, direction: activeDirection, gap: spacing[3], padding: spacing[4], width: "100%" },
    state: { alignItems: "center", direction: activeDirection, gap: spacing[3], paddingVertical: spacing[8], width: "100%" },
    eyebrow: { ...typography.label, color: theme.interactiveText, textAlign: startTextAlign },
    title: { ...typography.titleSm, color: theme.color, textAlign: startTextAlign },
    muted: { ...typography.bodySm, color: theme.colorMuted, lineHeight: 20, textAlign: startTextAlign },
    sectionTitle: { ...typography.bodyStrong, color: theme.color, textAlign: startTextAlign },
    section: { backgroundColor: theme.surfaceRaised, borderColor: theme.borderColor, borderRadius: radius.sm, borderWidth: borders.hairline, gap: spacing[2], padding: spacing[3] },
    item: { borderColor: theme.borderColor, borderTopWidth: borders.hairline, gap: spacing[1], paddingTop: spacing[2] },
    itemTitle: { ...typography.bodyStrong, color: theme.color, textAlign: startTextAlign },
    quantityInput: { borderColor: theme.borderColor, borderRadius: radius.sm, borderWidth: borders.hairline, color: theme.color, minHeight: sizing.controlSm, paddingHorizontal: spacing[3], textAlign: "left", writingDirection: "ltr" },
    disabledInput: { backgroundColor: theme.disabledBackground, borderColor: theme.disabledBackground, color: theme.disabledText },
    modifierGroup: { gap: spacing[2], marginTop: spacing[1] },
    modifierOptions: { flexDirection: "row", flexWrap: "wrap", gap: spacing[2] },
    modifierOption: { borderColor: theme.borderColor, borderRadius: radius.sm, borderWidth: borders.hairline, paddingHorizontal: spacing[2], paddingVertical: spacing[2] },
    modifierOptionSelected: { backgroundColor: theme.actionSoft, borderColor: theme.interactiveText },
    invalidModifierOption: { borderColor: theme.danger },
    selectedOptionText: { color: theme.interactiveText },
    back: { ...typography.body, color: theme.interactiveText, textAlign: startTextAlign },
    cartCta: { backgroundColor: theme.actionSoft, borderRadius: radius.sm, gap: spacing[2], padding: spacing[3] },
    button: { alignItems: "center", backgroundColor: theme.actionBackground, borderRadius: radius.sm, justifyContent: "center", minHeight: sizing.controlMd, paddingHorizontal: spacing[4] },
    buttonText: { ...typography.bodyStrong, color: theme.onAction },
    disabledButton: { backgroundColor: theme.disabledBackground, borderColor: theme.disabledBackground },
    disabledButtonText: { color: theme.disabledText },
    secondaryButton: { alignItems: "center", borderColor: theme.borderColor, borderRadius: radius.sm, borderWidth: borders.hairline, justifyContent: "center", minHeight: sizing.controlMd, paddingHorizontal: spacing[4] },
    secondaryButtonText: { ...typography.body, color: theme.color },
    success: { ...typography.bodySm, color: theme.success, lineHeight: 19, textAlign: startTextAlign },
    validationError: { ...typography.bodySm, color: theme.danger, lineHeight: 19, textAlign: startTextAlign },
    error: { ...typography.bodySm, color: theme.danger, lineHeight: 19, textAlign: startTextAlign },
  });
}

function formatQuantity(baseUnit: string, quantity: number): string {
  if (baseUnit === "GRAM") return `${String(quantity)} غ`;
  if (baseUnit === "MILLILITER") return `${String(quantity)} مل`;
  return String(quantity);
}

function isQuantityAllowed(offer: PublicCatalogResponse["offers"][number], quantity: number): boolean {
  return quantity >= offer.quantityMinBaseUnits && quantity <= offer.quantityMaxBaseUnits && (quantity - offer.quantityMinBaseUnits) % offer.quantityStepBaseUnits === 0;
}

function modifierGroupError(group: PublicCatalogResponse["offers"][number]["modifierGroups"][number], selectedIds: ReadonlyArray<string>): string {
  const selectedCount = group.options.filter((option) => selectedIds.includes(option.id)).length;
  if (selectedCount < group.minSelections) return `اختر ${group.minSelections} خيارًا على الأقل من ${group.nameAr}.`;
  if (selectedCount > group.maxSelections) return `اختر ${group.maxSelections} خيارًا كحد أقصى من ${group.nameAr}.`;
  return "";
}

function validateModifierSelection(offer: PublicCatalogResponse["offers"][number], selectedIds: ReadonlyArray<string>): string {
  if (new Set(selectedIds).size !== selectedIds.length) return "اختيارات الإضافات غير صالحة. أعد تحديد الخيارات.";
  const admittedOptions = new Map(offer.modifierGroups.flatMap((group) => group.options.map((option) => [option.id, option] as const)));
  for (const optionId of selectedIds) {
    const option = admittedOptions.get(optionId);
    if (!option?.availability) return "أحد الخيارات المحددة لم يعد متاحًا. حدّث الكتالوج ثم أعد المحاولة.";
  }
  for (const group of offer.modifierGroups) {
    const error = modifierGroupError(group, selectedIds);
    if (error) return error;
  }
  return "";
}

function dshMutationErrorMessage(cause: unknown, fallback: string): string {
  const code = cause && typeof cause === "object" && "code" in cause ? String((cause as { code?: unknown }).code) : "";
  if (code === "OFFER_UNAVAILABLE") return "لم يعد هذا المنتج متاحًا. حدّث الكتالوج ثم أعد المحاولة.";
  if (code === "INVALID_INPUT") return "تحقق من الكمية والخيارات المحددة ثم أعد المحاولة.";
  if (code === "UNAUTHENTICATED") return "سجّل الدخول لإضافة المنتج إلى السلة.";
  if (code === "STALE_CHECKOUT") return "تغيرت السلة أو بيانات المنتج. افتح السلة لقراءة الحالة الحالية.";
  return fallback;
}
