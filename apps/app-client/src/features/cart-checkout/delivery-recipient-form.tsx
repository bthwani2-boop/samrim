import { borders, normalizeYemenPhoneE164, radius, type resolveTheme, spacing, typography } from "@bthwani/design-system";
import { BthwaniChip, BthwaniSectionHeader, useAppearanceTheme } from "@bthwani/design-system/native";
import { useMemo } from "react";
import { StyleSheet, Text, TextInput, View } from "react-native";

export type DeliveryRecipientInput = Readonly<{
  mode: "SELF" | "OTHER";
  name?: string;
  phoneE164?: string;
  instructions?: string;
}>;

export function deliveryRecipientIsValid(value: DeliveryRecipientInput): boolean {
  if (value.mode === "SELF") return true;
  const name = value.name?.trim() ?? "";
  const phone = normalizeYemenPhoneE164(value.phoneE164?.trim() ?? "");
  const instructions = value.instructions?.trim() ?? "";
  return name.length >= 2 && name.length <= 120 && /^\+[1-9][0-9]{7,14}$/u.test(phone) && instructions.length <= 500;
}

export function checkoutRecipient(value: DeliveryRecipientInput, allowOther: boolean): DeliveryRecipientInput {
  if (!allowOther || value.mode !== "OTHER") return { mode: "SELF" };
  const recipient: { mode: "OTHER"; name?: string; phoneE164?: string; instructions?: string } = { mode: "OTHER" };
  const name = value.name?.trim();
  const phoneE164 = value.phoneE164?.trim();
  const instructions = value.instructions?.trim();
  if (name) recipient.name = name;
  if (phoneE164) recipient.phoneE164 = normalizeYemenPhoneE164(phoneE164);
  if (instructions) recipient.instructions = instructions;
  return recipient;
}

export function DeliveryRecipientForm({ value, allowOther, onChange }: {
  value: DeliveryRecipientInput;
  allowOther: boolean;
  onChange: (value: DeliveryRecipientInput) => void;
}) {
  const theme = useAppearanceTheme();
  const styles = useMemo(() => createStyles(theme), [theme]);
  const mode = allowOther ? value.mode : "SELF";

  return (
    <View style={styles.container} accessibilityLabel="بيانات مستلم الطلب">
      <BthwaniSectionHeader title="مستلم الطلب" subtitle={allowOther ? "بيانات المستلم تُحفظ لهذا الطلب فقط." : "الاستلام من المتجر لصاحب الطلب."} />
      <View style={styles.choices}>
        <BthwaniChip disabled={!allowOther} label="أنا المستلم" onPress={() => onChange({ mode: "SELF" })} selected={mode === "SELF"} />
        <BthwaniChip disabled={!allowOther} label="شخص آخر" onPress={() => onChange({ ...value, mode: "OTHER" })} selected={mode === "OTHER"} />
      </View>
      {mode === "OTHER" ? <View style={styles.fields}>
        <TextInput accessibilityLabel="اسم مستلم الطلب" autoCapitalize="words" autoComplete="name" maxLength={120} onChangeText={(name) => onChange({ ...value, mode: "OTHER", name })} placeholder="اسم المستلم" placeholderTextColor={theme.colorMuted} style={styles.input} value={value.name ?? ""} />
        <TextInput accessibilityLabel="رقم المستلم" autoComplete="tel" keyboardType="phone-pad" maxLength={20} onChangeText={(phoneE164) => onChange({ ...value, mode: "OTHER", phoneE164 })} placeholder="مثال: 777123456 أو +967777123456" placeholderTextColor={theme.colorMuted} style={styles.input} value={value.phoneE164 ?? ""} />
        <TextInput accessibilityLabel="تعليمات توصيل المستلم" maxLength={500} multiline onChangeText={(instructions) => onChange({ ...value, mode: "OTHER", instructions })} placeholder="تعليمات للمندوب (اختياري)" placeholderTextColor={theme.colorMuted} style={[styles.input, styles.instructions]} textAlignVertical="top" value={value.instructions ?? ""} />
        {!deliveryRecipientIsValid(value) ? <Text accessibilityRole="alert" style={styles.error}>أدخل اسمًا ورقمًا يمنيًا صحيحًا للمستلم، محليًا أو دوليًا.</Text> : null}
      </View> : null}
    </View>
  );
}

function createStyles(theme: ReturnType<typeof resolveTheme>) {
  return StyleSheet.create({
    container: { backgroundColor: theme.surfaceRaised, borderColor: theme.borderColor, borderRadius: radius.sm, borderWidth: borders.hairline, gap: spacing[2], padding: spacing[3] },
    choices: { flexDirection: "row", flexWrap: "wrap", gap: spacing[2] },
    fields: { gap: spacing[2] },
    input: { ...typography.bodySm, backgroundColor: theme.surface, borderColor: theme.borderColor, borderRadius: radius.sm, borderWidth: borders.hairline, color: theme.color, minHeight: 42, paddingHorizontal: spacing[2] },
    instructions: { minHeight: 80, paddingVertical: spacing[2] },
    error: { ...typography.bodySm, color: theme.danger },
  });
}
