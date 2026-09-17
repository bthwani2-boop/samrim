import { type Href, useRouter } from "expo-router";
import { useCallback, useEffect, useMemo, useState } from "react";
import { ActivityIndicator, Pressable, StyleSheet, Text, TextInput, View } from "react-native";
import { useAppearanceTheme } from "@bthwani/design-system/native";

import { direction, resolveTextAlign, resolveTheme, toAsciiDigits } from "@bthwani/design-system";
import { formatMoney, type PublicCatalogResponse, type PublicStoreView } from "@bthwani/dsh";
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
      router.replace("/?returnTo=/store/" + encodeURIComponent(storeId) as Href);
      return;
    }
    const quantity = Number(quantities[offer.offerId] ?? String(offer.quantityMinBaseUnits));
    if (!Number.isSafeInteger(quantity) || !isQuantityAllowed(offer, quantity)) {
      setError("الكمية لا تطابق الحد الأدنى أو الأقصى أو خطوة الكمية لهذا العرض.");
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
      setError("تعذر إضافة المنتج. أعد المحاولة أو افتح السلة لقراءة حالتها.");
    } finally {
      setBusyOfferId("");
    }
  }

  const renderOffer = (offer: PublicCatalogResponse["offers"][number]) => {
    const selectedOptions = selectedModifierOptionIds[offer.offerId] ?? [];
    const quantity = quantities[offer.offerId] ?? String(offer.quantityMinBaseUnits);
    const busy = busyOfferId === offer.offerId;
    return (
      <View key={offer.offerId} style={styles.item}>
        <Text style={styles.itemTitle}>{offer.productName}</Text>
        <Text style={styles.muted}>{formatMoney(offer.priceMinor, offer.currency)} · {offer.measurementKind === "DISCRETE" ? "بالقطعة" : offer.baseUnit === "GRAM" ? "بالغرام" : "بالمليلتر"}</Text>
        <Text style={styles.muted}>الكمية: {formatQuantity(offer.baseUnit, offer.quantityMinBaseUnits)}–{formatQuantity(offer.baseUnit, offer.quantityMaxBaseUnits)} بخطوة {formatQuantity(offer.baseUnit, offer.quantityStepBaseUnits)}</Text>
        <TextInput accessibilityLabel={"كمية " + offer.productName} editable={!busy} keyboardType="number-pad" onChangeText={(value) => setQuantities((current) => ({ ...current, [offer.offerId]: toAsciiDigits(value).replace(/[^0-9]/g, "") }))} value={quantity} style={[styles.quantityInput, busy && styles.disabledInput]} />
        {offer.modifierGroups.map((group) => (
          <View key={group.id} style={styles.modifierGroup}>
            <Text style={styles.muted}>{group.nameAr}{group.required ? " · مطلوب" : ""}</Text>
            <View style={styles.modifierOptions}>
              {group.options.filter((option) => option.availability).map((option) => {
                const selected = selectedOptions.includes(option.id);
                return <Pressable key={option.id} accessibilityRole="button" accessibilityState={{ selected, disabled: busy }} disabled={busy} onPress={() => toggleModifier(offer, group.id, option.id, group.maxSelections)} style={[styles.modifierOption, selected && styles.modifierOptionSelected]}><Text style={[styles.secondaryButtonText, selected && styles.selectedOptionText]}>{option.nameAr}{option.priceDeltaMinor ? " · +" + formatMoney(option.priceDeltaMinor, offer.currency) : ""}</Text></Pressable>;
              })}
            </View>
          </View>
        ))}
        <Pressable accessibilityRole="button" accessibilityLabel={"إضافة " + offer.productName} accessibilityState={{ busy, disabled: busy }} disabled={busy} onPress={() => void add(offer)} style={[styles.button, busy && styles.disabledButton]}><Text style={[styles.buttonText, busy && styles.disabledButtonText]}>{busy ? "جارٍ الإضافة…" : "إضافة إلى السلة"}</Text></Pressable>
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
        <Pressable accessibilityRole="button" accessibilityLabel="فتح السلة" onPress={() => router.push(`/cart/${encodeURIComponent(storeId)}` as Href)} style={styles.button}><Text style={styles.buttonText}>فتح السلة</Text></Pressable>
      </View>
      {error ? <Text accessibilityRole="alert" style={styles.error}>{error}</Text> : null}
    </View>
  );
}

function createStyles(theme: ReturnType<typeof resolveTheme>) {
  const activeDirection = direction.defaultDirection;
  const startTextAlign = resolveTextAlign("start", activeDirection);
  return StyleSheet.create({
    container: { backgroundColor: theme.surface, borderColor: theme.borderColor, borderRadius: 14, borderWidth: 1, direction: activeDirection, gap: 10, padding: 14, width: "100%" },
    state: { alignItems: "center", direction: activeDirection, gap: 10, paddingVertical: 28, width: "100%" },
    eyebrow: { color: theme.interactiveText, fontSize: 13, fontWeight: "800", textAlign: startTextAlign },
    title: { color: theme.color, fontSize: 20, fontWeight: "800", textAlign: startTextAlign },
    muted: { color: theme.colorMuted, fontSize: 13, lineHeight: 20, textAlign: startTextAlign },
    sectionTitle: { color: theme.color, fontSize: 15, fontWeight: "800", textAlign: startTextAlign },
    section: { backgroundColor: theme.surfaceRaised, borderColor: theme.borderColor, borderRadius: 10, borderWidth: 1, gap: 8, padding: 10 },
    item: { borderColor: theme.borderColor, borderTopWidth: 1, gap: 3, paddingTop: 8 },
    itemTitle: { color: theme.color, fontSize: 14, fontWeight: "800", textAlign: startTextAlign },
    quantityInput: { borderColor: theme.borderColor, borderRadius: 8, borderWidth: 1, color: theme.color, minHeight: 40, paddingHorizontal: 10, textAlign: "left", writingDirection: "ltr" },
    disabledInput: { backgroundColor: theme.disabledBackground, borderColor: theme.disabledBackground, color: theme.disabledText },
    modifierGroup: { gap: 6, marginTop: 4 },
    modifierOptions: { flexDirection: "row", flexWrap: "wrap", gap: 6 },
    modifierOption: { borderColor: theme.borderColor, borderRadius: 8, borderWidth: 1, paddingHorizontal: 8, paddingVertical: 7 },
    modifierOptionSelected: { backgroundColor: theme.actionSoft, borderColor: theme.interactiveText },
    selectedOptionText: { color: theme.interactiveText },
    back: { color: theme.interactiveText, fontSize: 14, fontWeight: "700", textAlign: startTextAlign },
    cartCta: { backgroundColor: theme.actionSoft, borderRadius: 10, gap: 8, padding: 10 },
    button: { alignItems: "center", backgroundColor: theme.actionBackground, borderRadius: 10, justifyContent: "center", minHeight: 44, paddingHorizontal: 14 },
    buttonText: { color: theme.onAction, fontWeight: "800" },
    disabledButton: { backgroundColor: theme.disabledBackground, borderColor: theme.disabledBackground },
    disabledButtonText: { color: theme.disabledText },
    secondaryButton: { alignItems: "center", borderColor: theme.borderColor, borderRadius: 10, borderWidth: 1, justifyContent: "center", minHeight: 44, paddingHorizontal: 14 },
    secondaryButtonText: { color: theme.color, fontWeight: "700" },
    success: { color: theme.success, fontSize: 13, lineHeight: 19, textAlign: startTextAlign },
    error: { color: theme.danger, fontSize: 13, lineHeight: 19, textAlign: startTextAlign },
  });
}

function formatQuantity(baseUnit: string, quantity: number): string {
  if (baseUnit === "GRAM") return String(quantity) + " غ";
  if (baseUnit === "MILLILITER") return String(quantity) + " مل";
  return String(quantity);
}

function isQuantityAllowed(offer: PublicCatalogResponse["offers"][number], quantity: number): boolean {
  return quantity >= offer.quantityMinBaseUnits && quantity <= offer.quantityMaxBaseUnits && (quantity - offer.quantityMinBaseUnits) % offer.quantityStepBaseUnits === 0;
}
