import type { MerchantRegistrationChoice } from "@bthwani/dsh";
import { useMobileAppearance } from "@bthwani/tamagui-config/appearance";
import { Pressable, Text, View } from "react-native";

const descriptions = {
  DIRECT: {
    title: "متجر مباشر",
    detail: "البيع الخاص المباشر عبر رابط متجرك بعد النشر؛ لا يظهر في سوق بثواني.",
  },
  MARKETPLACE: {
    title: "داخل سوق بثواني",
    detail: "البيع الخاص المباشر عبر رابط متجرك، بالإضافة إلى البيع عبر سوق بثواني بعد النشر واستيفاء أهلية السوق.",
  },
} as const;

export default function StoreRelationChoice({ choices, selectedKey, disabled, onSelect }: Readonly<{
  choices: readonly MerchantRegistrationChoice[];
  selectedKey: string;
  disabled: boolean;
  onSelect: (key: string) => void;
}>) {
  const { theme } = useMobileAppearance();
  return (
    <View style={{ gap: 10 }} testID="merchant-relation-choices">
      <Text accessibilityRole="header" style={{ color: theme.color, fontWeight: "700", fontSize: 18 }}>
        اختر قنوات البيع لمتجرك
      </Text>
      <Text style={{ color: theme.colorSecondary }}>
        إدارة المتجر والمنتجات مشتركة بين الخيارين. أهلية سوق بثواني هي الفرق الأساسي. تحدد الاتفاقيات والسياسات العمولة والاشتراك والتحصيل والدفع والتوصيل.
      </Text>
      {choices.map(choice => {
        const key = `${choice.cityId}:${choice.relation}`;
        const selected = key === selectedKey;
        const details = descriptions[choice.relation];
        return (
          <Pressable key={key} accessibilityRole="radio"
            accessibilityLabel={`${details.title} — ${choice.cityId}`}
            accessibilityState={{ checked: selected, disabled }}
            testID={`merchant-relation-${choice.relation}-${choice.cityId}`}
            disabled={disabled} onPress={() => onSelect(key)}
            style={{
              minHeight: 80, padding: 14, borderWidth: selected ? 2 : 1,
              borderColor: selected ? theme.interactiveText : theme.borderColor,
              borderRadius: 12, backgroundColor: selected ? theme.actionSoft : theme.surface,
              opacity: disabled ? 0.6 : 1, gap: 6,
            }}>
            <Text style={{ color: theme.color, fontWeight: "700", fontSize: 17 }}>
              {selected ? "◉ " : "○ "}{details.title}
            </Text>
            <Text style={{ color: theme.colorSecondary }}>{details.detail}</Text>
            <Text style={{ color: theme.colorSecondary }}>
              استقبال الطلبات ممكن فقط بعد اعتماد النشر وجاهزية الطلب والدفع وطريقة التنفيذ؛ اختيار النوع لا يفعّلها تلقائيًا.
            </Text>
            <Text style={{ color: theme.colorSecondary }}>
              المدينة: {choice.cityId} · شروط التسجيل: {choice.termsVersion}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}
