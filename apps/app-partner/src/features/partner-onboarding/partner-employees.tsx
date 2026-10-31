import { typography } from "@bthwani/design-system";
import { BthwaniButton, BthwaniIcon, useAppearanceTheme } from "@bthwani/design-system/native";
import { useMemo, useState } from "react";
import { ActivityIndicator, StyleSheet, Text, View } from "react-native";

import { PartnerStoreAccess } from "./partner-store-access";
import { PartnerStoreScopeSelector } from "./partner-store-scope-selector";
import { usePartnerStoreScope } from "./partner-store-scope-context";

export function PartnerEmployees() {
  const theme = useAppearanceTheme();
  const styles = useMemo(() => StyleSheet.create({
    page: { gap: 16, paddingBottom: 28 },
    header: { flexDirection: "row", flexWrap: "wrap", alignItems: "center", justifyContent: "space-between", gap: 14 },
    heading: { flex: 1, minWidth: 210, gap: 6 },
    eyebrow: { ...typography.caption, color: theme.brandAction, fontWeight: "800" },
    title: { ...typography.titleLg, color: theme.color, fontWeight: "800" },
    description: { ...typography.bodySm, color: theme.colorMuted, maxWidth: 680 },
    buttonArea: { minWidth: 150 },
    notice: { padding: 15, gap: 10, borderRadius: 14, borderColor: theme.borderColor, borderWidth: 1, backgroundColor: theme.surface },
    strong: { ...typography.bodyStrong, color: theme.color },
    muted: { ...typography.bodySm, color: theme.colorMuted },
    hint: { borderRadius: 12, backgroundColor: theme.surfaceInset, padding: 13, flexDirection: "row", alignItems: "center", gap: 10 },
    hintText: { ...typography.bodySm, color: theme.colorMuted, flex: 1 },
  }), [theme]);
  const { selectedStore, stores, state, reload } = usePartnerStoreScope();
  const [showForm, setShowForm] = useState(false);
  const ownedStores = stores.filter(store => store.owned);
  const currentStore = selectedStore?.owned ? selectedStore : null;

  return <View style={styles.page} accessibilityLabel="مساحة إدارة موظفي المتجر">
    <View style={styles.header}>
      <View style={styles.heading}>
        <Text style={styles.eyebrow}>إدارة المتجر</Text>
        <Text accessibilityRole="header" style={styles.title}>الموظفين</Text>
        <Text style={styles.description}>ادعُ موظفي المتجر، وحدّد مسؤولياتهم، وتابع قبول الدعوات وصلاحيات الوصول أو إيقافها دون مشاركة بيانات تسجيل الدخول.</Text>
      </View>
      {currentStore ? <View style={styles.buttonArea}>
        <BthwaniButton label={showForm ? "إغلاق إضافة موظف" : "إضافة موظف"} variant={showForm ? "secondary" : "primary"}
          onPress={() => setShowForm(value => !value)} />
      </View> : null}
    </View>

    {state.kind === "loading" ? <View style={styles.notice}>
      <ActivityIndicator accessibilityLabel="جارٍ التحقق من المتاجر المملوكة" color={theme.actionBackground}/>
      <Text style={styles.muted}>جارٍ قراءة المتاجر التي يمكنك إدارة موظفيها…</Text>
    </View> : null}
    {state.kind === "error" ? <View style={styles.notice}>
      <Text accessibilityRole="alert" style={styles.strong}>تعذر التحقق من المتاجر والصلاحيات.</Text>
      <BthwaniButton label="إعادة المحاولة" variant="secondary" onPress={() => void reload()}/>
    </View> : null}
    {state.kind === "ready" && ownedStores.length === 0 ? <View style={styles.notice}>
      <Text style={styles.strong}>إدارة الموظفين متاحة لمالك المتجر فقط.</Text>
      <Text style={styles.muted}>لا يوجد متجر مملوك لهذا الحساب. لا تمنح عضوية موظف في متجر آخر صلاحية إنشاء أو تعديل الدعوات.</Text>
    </View> : null}
    {state.kind === "ready" && ownedStores.length > 0 && (ownedStores.length > 1 || !currentStore) ? <PartnerStoreScopeSelector ownedOnly /> : null}
    {state.kind === "ready" && ownedStores.length > 0 && !currentStore ? <View style={styles.notice}>
      <Text style={styles.strong}>اختر أحد متاجرك المملوكة من القائمة للمتابعة.</Text>
      <Text style={styles.muted}>لن تُعرض بيانات الموظفين أو صلاحياتهم لمتجر ليس تحت ملكيتك.</Text>
    </View> : null}
    {state.kind === "ready" && currentStore ? <>
      <View style={styles.hint}>
        <BthwaniIcon name="store" color={theme.brandAction} size={19}/>
        <Text style={styles.hintText}>إدارة موظفي {currentStore.name} — الدعوة تمنح صلاحيات محددة للمتجر فقط، ولا تمنح ملكيته أو صلاحية صرف أمواله.</Text>
      </View>
      <PartnerStoreAccess key={currentStore.id} storeID={currentStore.id} showForm={showForm}/>
    </> : null}
  </View>;
}
