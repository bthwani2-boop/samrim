import { useMobileAppearance } from "@bthwani/tamagui-config/appearance";
import { Pressable, Text, TextInput, View } from "react-native";
import { normalizeServiceCityId } from "./serviceability";

type Props = Readonly<{
  draftCity: string;
  onDraftChange: (value: string) => void;
  onApply: (cityId: string) => void;
}>;

export default function ServiceCityScope({ draftCity, onDraftChange, onApply }: Props) {
  const { theme } = useMobileAppearance();
  const apply = () => onApply(normalizeServiceCityId(draftCity));
  return <>
    <Text accessibilityRole="text" style={{ color: theme.color }}>رمز مدينة الخدمة</Text>
    <View style={{ flexDirection: "row", gap: 8 }}>
      <TextInput testID="city-input" accessibilityLabel="رمز مدينة الخدمة" value={draftCity}
        onChangeText={onDraftChange} autoCapitalize="none" returnKeyType="search"
        onSubmitEditing={apply} style={{
          color: theme.color, flex: 1, padding: 12, borderWidth: 1,
          borderRadius: 10, borderColor: theme.borderColor,
        }} />
      <Pressable accessibilityRole="button" accessibilityLabel="تغيير مدينة الخدمة" onPress={apply}
        style={{
          padding: 14, borderRadius: 12, borderWidth: 1,
          borderColor: theme.borderColor, backgroundColor: theme.actionSoft,
        }}>
        <Text style={{ color: theme.interactiveText }}>عرض</Text>
      </Pressable>
    </View>
  </>;
}
