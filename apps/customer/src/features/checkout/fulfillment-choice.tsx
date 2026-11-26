import type { CheckoutFulfillmentMode } from "@bthwani/dsh";
import { useMobileAppearance } from "@bthwani/tamagui-config/appearance";
import { Pressable, Text, View } from "react-native";

const modes = [
  ["BTHWANI_CAPTAIN", "توصيل بثواني"],
  ["PARTNER_CAPTAIN", "توصيل المتجر"],
  ["CUSTOMER_PICKUP", "استلام من المتجر"],
] as const;
export default function FulfillmentChoice({ label, value, onChange }: Readonly<{
  label?: string; value?: CheckoutFulfillmentMode | null; onChange?: (mode: CheckoutFulfillmentMode) => void;
}>) {
  const { theme } = useMobileAppearance();
  if (!onChange) return label ? <Text style={{ color: theme.colorSecondary, lineHeight: 24 }}>{label}</Text> : null;
  return <View style={{ gap: 8 }}>
    <Text style={{ color: theme.color, fontWeight: "700" }}>طريقة التنفيذ المطلوبة للمراجعة</Text>
    <Text style={{ color: theme.colorSecondary }}>هذه اختيارات للمراجعة فقط. لم تعتمد DSH إتاحة أي منها بعد.</Text>
    {modes.map(([mode, name]) => <Pressable key={mode} accessibilityRole="button" accessibilityState={{ selected: value === mode }}
      style={{ minHeight: 44, justifyContent: "center", padding: 10, borderColor: theme.borderColor, borderWidth: 1, borderRadius: 8,
        backgroundColor: value === mode ? theme.actionSoft : theme.surface }} onPress={() => onChange(mode)}>
      <Text style={{ color: theme.color }}>{name}</Text>
    </Pressable>)}
  </View>;
}
