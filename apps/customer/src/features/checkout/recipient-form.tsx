import type { CheckoutRecipientPurpose } from "@bthwani/dsh";
import { useMobileAppearance } from "@bthwani/tamagui-config/appearance";
import { Pressable, Text, TextInput, View } from "react-native";

type Draft = Readonly<{ purpose: CheckoutRecipientPurpose; name: string; phone: string; instructions: string }>;
type Props = Readonly<{ label?: string; value?: Draft; onChange?: (value: Draft) => void; pickup?: boolean }>;
export default function RecipientForm({ label, value, onChange, pickup }: Props) {
  const { theme } = useMobileAppearance();
  if (!value || !onChange) return label ? <Text style={{ color: theme.colorSecondary, lineHeight: 24 }}>{label}</Text> : null;
  const input = { color: theme.color, borderColor: theme.borderColor, borderWidth: 1, borderRadius: 8, minHeight: 44, padding: 10 };
  return <View style={{ gap: 8 }}>
    <Text style={{ color: theme.color, fontWeight: "700" }}>من سيستلم الطلب؟</Text>
    {(["SELF", "OTHER"] as const).map(purpose => <Pressable key={purpose} accessibilityRole="button"
      accessibilityState={{ selected: value.purpose === purpose }} style={{ ...input, backgroundColor: value.purpose === purpose ? theme.actionSoft : theme.surface }}
      onPress={() => onChange({ purpose, name: "", phone: "", instructions: "" })}>
      <Text style={{ color: theme.color }}>{purpose === "SELF" ? "أنا" : "شخص آخر"}</Text>
    </Pressable>)}
    {value.purpose === "OTHER" ? <>
      <TextInput accessibilityLabel="اسم المستلم" placeholder="اسم المستلم" value={value.name} maxLength={100}
        placeholderTextColor={theme.colorSecondary} style={input} onChangeText={name => onChange({ ...value, name })} />
      <TextInput accessibilityLabel="هاتف المستلم" placeholder="+967..." value={value.phone} keyboardType="phone-pad" maxLength={16}
        placeholderTextColor={theme.colorSecondary} style={input} onChangeText={phone => onChange({ ...value, phone })} />
      {!pickup ? <TextInput accessibilityLabel="تعليمات التوصيل (اختياري)" placeholder="تعليمات التوصيل (اختياري)"
        value={value.instructions} maxLength={300} placeholderTextColor={theme.colorSecondary} style={input}
        onChangeText={instructions => onChange({ ...value, instructions })} /> : null}
      <Text style={{ color: theme.colorSecondary }}>يبقى حسابك هو صاحب الطلب والدفع. هذه البيانات للمراجعة ولا تُحفظ الآن.</Text>
    </> : null}
  </View>;
}
