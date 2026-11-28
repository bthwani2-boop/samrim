import type { MerchantOwnedStore } from "@bthwani/dsh";
import { useMobileAppearance } from "@bthwani/tamagui-config/appearance";
import { useState } from "react";
import { Pressable, Text, View } from "react-native";
import MerchantCapabilityScreen from "../../components/merchant-capability-screen";
import CommercialAgreement from "./commercial-agreement";

export default function WalletScreen({ actorId = "", stores = [] }: { actorId?: string; stores?: readonly MerchantOwnedStore[] } = {}) {
  const { theme } = useMobileAppearance();
  const [target, setTarget] = useState<{ actorId: string; storeId: string } | null>(null);
  const selected = target?.actorId === actorId ? stores.find(store => store.id === target.storeId) : undefined;
  if (!actorId) return <MerchantCapabilityScreen title="المالية" message="تتطلب القراءة المالية جلسة تاجر موثقة." />;
  return (
    <View style={{ gap: 12 }}>
      <Text accessibilityRole="header" style={{ color: theme.color, fontSize: 19, fontWeight: "700" }}>المالية حسب المتجر</Text>
      <Text style={{ color: theme.colorSecondary }}>الأرصدة والحركات والمستحقات والتسويات غير متاحة حاليًا؛ لا تُعرض مبالغ غير مؤكدة.</Text>
      {stores.length === 0 ? <Text style={{ color: theme.warningText }}>لا توجد متاجر متاحة لحسابك.</Text> :
        <Text style={{ color: theme.color }}>اختر متجرًا للتحقق من مقترح الاتفاقية المالية لدى WLT.</Text>}
      <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
        {stores.map(store => (
          <Pressable key={store.id} accessibilityRole="button" accessibilityLabel={"مالية متجر " + store.name}
            accessibilityState={{ selected: selected?.id === store.id }} onPress={() => setTarget({ actorId, storeId: store.id })}
            style={{ minHeight: 44, justifyContent: "center", paddingHorizontal: 12, borderWidth: 1,
              borderRadius: 10, borderColor: theme.borderColor, backgroundColor: selected?.id === store.id ? theme.actionSoft : theme.surface }}>
            <Text style={{ color: theme.color }}>{store.name}</Text>
          </Pressable>
        ))}
      </View>
      {selected ? <CommercialAgreement key={JSON.stringify([actorId, selected.id])} actorId={actorId} storeId={selected.id} /> : null}
    </View>
  );
}
