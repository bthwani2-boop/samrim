import type { MerchantRegistrationChoice } from "@bthwani/dsh";
import { useMobileAppearance } from "@bthwani/tamagui-config/appearance";
import { Pressable, Text, View } from "react-native";

const descriptions = {
  DIRECT: {
    title: "متجر مباشر",
    detail: "يصل العملاء إلى صفحة المتجر عبر رابطه المعتمد بعد النشر. لا يُدرج المتجر تلقائيًا في دليل سوق بثواني.",
  },
  MARKETPLACE: {
    title: "داخل سوق بثواني",
    detail: "يمكن أن يظهر المتجر في دليل السوق بعد مراجعة النشر واستيفاء متطلبات الظهور. اختيار النموذج لا ينشر المتجر تلقائيًا.",
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
        اختر طريقة ظهور متجرك
      </Text>
      <Text style={{ color: theme.colorSecondary }}>
        الخيارات التالية متاحة حاليًا بحسب سياسة التسجيل لدى DSH. اختيار النموذج مستقل عن العمولة والاشتراك والتحصيل والتوصيل؛ تحدد هذه الالتزامات الاتفاقيات والسياسات المعتمدة لكل متجر.
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
              المدينة: {choice.cityId} · شروط التسجيل: {choice.termsVersion}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}
