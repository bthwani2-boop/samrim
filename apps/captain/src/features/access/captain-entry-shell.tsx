import { Text, View } from "react-native";

// Presentation-only preview of the four existing protected Expo Router tabs.
// No href, press callback, owner query, cached task, or financial data is exposed.
const primaryTabs = [
  { name: "home", title: "الرئيسية" },
  { name: "deliveries", title: "التوصيلات" },
  { name: "wallet", title: "المحفظة" },
  { name: "account", title: "حسابي" },
] as const;

export default function CaptainEntryShell({ color, borderColor, backgroundColor }: Readonly<{
  color: string;
  borderColor: string;
  backgroundColor: string;
}>) {
  return (
    <View testID="captain-guest-shell" accessibilityLabel="أقسام الكابتن غير متاحة قبل اعتماد الحساب"
      style={{ backgroundColor, borderTopColor: borderColor, borderTopWidth: 1, padding: 10, gap: 8 }}>
      <Text style={{ color, textAlign: "center", fontSize: 12 }}>
        الأقسام الرئيسية — تتاح بعد التحقق من الهوية وأهلية الكابتن
      </Text>
      <View style={{ flexDirection: "row", direction: "rtl", gap: 6 }}>
        {primaryTabs.map(tab => (
          <View key={tab.name} testID={`captain-guest-tab-${tab.name}`}
            accessible accessibilityRole="tab" accessibilityState={{ disabled: true }}
            accessibilityLabel={`${tab.title} — غير متاح`}
            style={{ flex: 1, minHeight: 44, justifyContent: "center", padding: 5,
              borderWidth: 1, borderRadius: 8, borderColor, opacity: 0.7 }}>
            <Text style={{ color, fontSize: 12, textAlign: "center" }}>{tab.title}</Text>
          </View>
        ))}
      </View>
    </View>
  );
}
