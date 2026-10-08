import { type MediaProvenanceInput } from "@bthwani/dsh";
import { BthwaniChip, useAppearanceTheme } from "@bthwani/design-system/native";
import { useMemo, useState } from "react";
import { Switch, Text, TextInput, View } from "react-native";

import { createFieldOperationStyles } from "./field-operation-styles";

type MediaSourceKind = "own_photo" | "owner_provided" | "other";

const sourceDescriptions: Readonly<Record<Exclude<MediaSourceKind, "other">, string>> = {
  own_photo: "صورة التقطها موظف الميدان بنفسه في موقع المتجر.",
  owner_provided: "صورة قدّمها مالك المتجر لموقع متجره.",
};

function sourceKindFor(value: MediaProvenanceInput): MediaSourceKind {
  if (value.sourceDescription === sourceDescriptions.own_photo) return "own_photo";
  if (value.sourceDescription === sourceDescriptions.owner_provided) return "owner_provided";
  return "other";
}

export function FieldMediaProvenanceEditor({ value, disabled, onChange }: Readonly<{
  value: MediaProvenanceInput;
  disabled: boolean;
  onChange: (value: MediaProvenanceInput) => void;
}>) {
  const theme = useAppearanceTheme();
  const styles = useMemo(() => createFieldOperationStyles(theme), [theme]);
  const [sourceKind, setSourceKind] = useState<MediaSourceKind>(() => sourceKindFor(value));
  const [customSourceDescription, setCustomSourceDescription] = useState(() => sourceKindFor(value) === "other" ? value.sourceDescription : "");
  const [showLinks, setShowLinks] = useState(Boolean(value.sourceUri || value.rightsUri));

  function chooseSource(next: MediaSourceKind) {
    if (sourceKind === "other") setCustomSourceDescription(value.sourceDescription);
    setSourceKind(next);
    if (next !== "other") onChange({ ...value, sourceDescription: sourceDescriptions[next] });
    else onChange({ ...value, sourceDescription: customSourceDescription });
  }

  return <View style={{ gap: 12 }}>
    <Text style={styles.cardTitle}>مصدر صورة المتجر وحق عرضها</Text>
    <Text style={styles.muted}>اختر مصدر الصورة بدقة. هذا الاختيار يسجل وصف المصدر فقط ولا يمنح إذنًا تلقائيًا باستخدام الصورة. أكمل بيانات المنشئ والحق وأكّد صحتها قبل الرفع.</Text>
    <Text style={styles.muted}>يلزم اسم المنشئ (حرفان على الأقل)، ووصف المصدر (3 أحرف)، وبيان حق العرض (5 أحرف) مع التأكيد. الروابط اختيارية.</Text>
    <View style={styles.optionList}>
      <BthwaniChip disabled={disabled} label="صورتها بنفسي" onPress={() => chooseSource("own_photo")} selected={sourceKind === "own_photo"} />
      <BthwaniChip disabled={disabled} label="قدّمها المالك" onPress={() => chooseSource("owner_provided")} selected={sourceKind === "owner_provided"} />
      <BthwaniChip disabled={disabled} label="مصدر آخر" onPress={() => chooseSource("other")} selected={sourceKind === "other"} />
    </View>
    <Text style={styles.label}>منشئ الصورة</Text>
    <TextInput accessibilityLabel="منشئ الصورة" editable={!disabled} maxLength={200} placeholder="اسم المصور أو الجهة المنشئة" placeholderTextColor={theme.colorMuted} style={styles.input} value={value.creator} onChangeText={(creator) => onChange({ ...value, creator })} />
    {sourceKind === "other" ? <>
      <Text style={styles.label}>كيف حصلت على الصورة؟</Text>
      <TextInput accessibilityLabel="وصف مصدر الصورة" editable={!disabled} maxLength={1000} placeholder="صف المصدر كما حدث فعلًا" placeholderTextColor={theme.colorMuted} style={styles.input} value={value.sourceDescription} onChangeText={(sourceDescription) => { setCustomSourceDescription(sourceDescription); onChange({ ...value, sourceDescription }); }} />
    </> : null}
    <Text style={styles.label}>ما الحق الذي يسمح بعرضها؟</Text>
    <TextInput accessibilityLabel="بيان حق استخدام الصورة" editable={!disabled} maxLength={2000} multiline placeholder="مثال: أذن المالك بعرض الصورة في صفحة متجره" placeholderTextColor={theme.colorMuted} style={[styles.input, { minHeight: 72, paddingTop: 12, textAlignVertical: "top" }]} value={value.rightsStatement} onChangeText={(rightsStatement) => onChange({ ...value, rightsStatement })} />
    <View style={styles.optionList}>
      <Switch disabled={disabled} value={value.rightsAttested} onValueChange={(rightsAttested) => onChange({ ...value, rightsAttested })} />
      <Text style={styles.muted}>أؤكد أن بيانات المنشئ والمصدر وحق العرض أعلاه صحيحة.</Text>
    </View>
    <BthwaniChip disabled={disabled} label={showLinks ? "إخفاء حقول الروابط الاختيارية" : "إضافة روابط المصدر أو الترخيص (اختياري)"} onPress={() => setShowLinks((current) => !current)} selected={showLinks} />
    {showLinks ? <>
      <TextInput accessibilityLabel="رابط مصدر الصورة اختياري" editable={!disabled} autoCapitalize="none" keyboardType="url" maxLength={2048} placeholder="رابط المصدر، إن وجد" placeholderTextColor={theme.colorMuted} style={[styles.input, styles.phoneInput]} value={value.sourceUri ?? ""} onChangeText={(sourceUri) => onChange({ ...value, sourceUri })} />
      <TextInput accessibilityLabel="رابط شروط الترخيص اختياري" editable={!disabled} autoCapitalize="none" keyboardType="url" maxLength={2048} placeholder="رابط شروط الترخيص، إن وجد" placeholderTextColor={theme.colorMuted} style={[styles.input, styles.phoneInput]} value={value.rightsUri ?? ""} onChangeText={(rightsUri) => onChange({ ...value, rightsUri })} />
    </> : null}
  </View>;
}
