import type { MerchantCatalogStatus } from "@bthwani/dsh";
import { useMobileAppearance } from "@bthwani/tamagui-config/appearance";
import { useEffect, useRef, useState } from "react";
import { Pressable, Text, View } from "react-native";
import type { MerchantOwnedStore } from "../access/dsh-standing";
import CatalogExport from "../catalog/catalog-export";
import InventorySummary from "../catalog/inventory-summary";

type Selection = Readonly<{ actorId: string; storeId: string; revision: number }>;

export default function InsightsScreen({ actorId = "", stores = [], initialStoreId, onOpenCatalog }: Readonly<{
  actorId?: string;
  stores?: readonly MerchantOwnedStore[];
  initialStoreId?: string | undefined;
  onOpenCatalog?: (storeId: string, status: MerchantCatalogStatus | undefined) => void;
}> = {}) {
  const { theme } = useMobileAppearance();
  const [selection, setSelection] = useState<Selection | null>(
    actorId && initialStoreId && stores.some(store => store.id === initialStoreId)
      ? { actorId, storeId: initialStoreId, revision: 0 } : null,
  );
  const selected = selection?.actorId === actorId
    ? stores.find(store => store.id === selection.storeId) : undefined;
  const activeSelection = useRef<Selection | null>(null);
  useEffect(() => {
    activeSelection.current = selected ? selection : null;
    return () => { activeSelection.current = null; };
  }, [selected, selection]);
  const button = {
    minHeight: 44, justifyContent: "center" as const, borderWidth: 1,
    borderRadius: 10, borderColor: theme.borderColor, paddingHorizontal: 14, paddingVertical: 8,
  };

  if (!actorId) return <Text accessibilityRole="alert" style={{ color: theme.warningText }}>
    افتح التقارير من مساحة التاجر الموثقة.
  </Text>;

  return <View testID="merchant-inventory-reports" style={{ gap: 14 }}>
    <Text accessibilityRole="header" style={{ color: theme.color, fontSize: 20, fontWeight: "700" }}>
      تقارير المخزون والكتالوج
    </Text>
    <Text style={{ color: theme.colorSecondary }}>
      تُقرأ مؤشرات العروض والمخزون من DSH للمتجر المحدد. لا تتضمن هذه التقارير المبيعات أو الطلبات أو المستحقات المالية.
    </Text>
    {stores.length === 0 ? <Text accessibilityRole="alert" style={{ color: theme.warningText }}>
      لا توجد متاجر مرتبطة بحسابك حاليًا.
    </Text> : <>
      <Text style={{ color: theme.color, fontWeight: "600" }}>اختر المتجر للتقرير</Text>
      <View accessibilityRole="radiogroup" accessibilityLabel="المتجر المحدد للتقرير"
        style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
        {stores.map(store => {
          const checked = selected?.id === store.id;
          return <Pressable key={store.id} accessibilityRole="radio"
            accessibilityLabel={`تقارير ${store.name}`} accessibilityState={{ checked }}
            aria-checked={checked} style={{ ...button, backgroundColor: checked ? theme.actionSoft : theme.surface }}
            onPress={() => setSelection(previous => previous?.actorId === actorId && previous.storeId === store.id
              ? previous : { actorId, storeId: store.id, revision: 0 })}>
            <Text style={{ color: checked ? theme.interactiveText : theme.color }}>{store.name}</Text>
          </Pressable>;
        })}
      </View>
    </>}
    {selected && selection ? <View key={JSON.stringify([actorId, selected.id])} style={{ gap: 12 }}>
      <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 8 }}>
        <Text accessibilityRole="header" style={{ color: theme.color, fontWeight: "700" }}>{selected.name}</Text>
        <Pressable accessibilityRole="button" accessibilityLabel="تحديث تقرير المخزون" style={button}
          onPress={() => setSelection(previous => previous === selection
            ? { ...selection, revision: selection.revision + 1 } : previous)}>
          <Text style={{ color: theme.interactiveText }}>تحديث التقرير</Text>
        </Pressable>
      </View>
      <InventorySummary key={JSON.stringify([actorId, selected.id, selection.revision])}
        actorId={actorId} storeId={selected.id}
        {...(onOpenCatalog ? { onShowStatus: (status: MerchantCatalogStatus | undefined) => {
          if (activeSelection.current === selection) onOpenCatalog(selected.id, status);
        } } : {})} />
      <CatalogExport actorId={actorId} storeId={selected.id} />
    </View> : null}
  </View>;
}
