import { useMobileAppearance } from "@bthwani/tamagui-config/appearance";
import { useState } from "react";
import { Pressable, Text, TextInput, View } from "react-native";
import { normalizeServiceCityId } from "./serviceability";

type Props = Readonly<{
  draftCity: string;
  onDraftChange: (value: string) => void;
  onApply: (cityId: string) => void;
}>;

export default function ServiceCityScope({ draftCity, onDraftChange, onApply }: Props) {
  const { theme } = useMobileAppearance();
  const [invalid, setInvalid] = useState(false);
  const apply = () => {
    const city = normalizeServiceCityId(draftCity);
    if (!city) {
      setInvalid(true);
      return;
    }
    setInvalid(false);
    onApply(city);
  };
  return <>
    <View style={{ flexDirection: "row", gap: 8 }}>
      <TextInput testID="city-input" accessibilityLabel="رمز مدينة الخدمة" value={draftCity}
        onChangeText={value => { setInvalid(false); onDraftChange(value); }}
        placeholder="رمز المدينة، مثل sanaa" placeholderTextColor={theme.colorSecondary}
        autoCapitalize="none" autoCorrect={false} returnKeyType="search"
        onSubmitEditing={apply} style={{
          color: theme.color, flex: 1, minWidth: 0, minHeight: 44, padding: 10, borderWidth: 1,
          borderRadius: 10, borderColor: invalid ? theme.dangerText : theme.borderColor,
        }} />
      <Pressable accessibilityRole="button" accessibilityLabel="تغيير مدينة الخدمة" onPress={apply}
        style={{
          padding: 14, borderRadius: 12, borderWidth: 1,
          borderColor: theme.borderColor, backgroundColor: theme.actionSoft,
        }}>
        <Text style={{ color: theme.interactiveText }}>عرض</Text>
      </Pressable>
    </View>
    {invalid ? <Text accessibilityRole="alert" style={{ color: theme.dangerText }}>
      أدخل رمز المدينة بالأحرف اللاتينية، مثل sanaa.
    </Text> : null}
  </>;
}
