import { isMediaProvenanceInputValid, type MediaProvenanceInput } from "@bthwani/dsh";
import { BthwaniChip, useAppearanceTheme } from "@bthwani/design-system/native";
import { useMemo, useState } from "react";
import { Switch, Text, TextInput, View } from "react-native";

import { createFieldOperationStyles } from "./field-operation-styles";

type SourceKind = "own_photo" | "owner_provided" | "other";
const sourceDescriptions = {
  own_photo: "صورة التقطها موظف الميدان بنفسه في موقع المتجر.",
  owner_provided: "صورة قدّمها مالك المتجر لموقع متجره.",
} as const;
const rightsStatements = {
  own_photo: "التقطت هذه الصورة وأسمح بعرضها في صفحة المتجر على بثواني.",
  owner_provided: "أكّد مالك المتجر سماحه بعرض هذه الصورة في صفحة متجره على بثواني.",
} as const;

function sourceKindFor(value: MediaProvenanceInput): SourceKind | null {
  if (!value.sourceDescription.trim()) return null;
  if (value.sourceDescription === sourceDescriptions.own_photo) return "own_photo";
  if (value.sourceDescription === sourceDescriptions.owner_provided) return "owner_provided";
  return "other";
}

export function FieldMediaProvenanceEditor({ value, disabled, onChange, creatorName = "" }: Readonly<{
  value: MediaProvenanceInput;
  disabled: boolean;
  onChange: (value: MediaProvenanceInput) => void;
  creatorName?: string;
}>) {
  const theme = useAppearanceTheme();
  const styles = useMemo(() => createFieldOperationStyles(theme), [theme]);
  const [showLinks, setShowLinks] = useState(false);
  const [sourceKind, setSourceKind] = useState<SourceKind | null>(() => sourceKindFor(value));

  function chooseSource(next: SourceKind) {
    setSourceKind(next);
    onChange({
      ...value,
      creator: next === "own_photo" ? creatorName.trim() : "",
      sourceDescription: next === "other" ? "" : sourceDescriptions[next],
      rightsStatement: next === "other" ? "" : rightsStatements[next],
      rightsAttested: false,
      sourceUri: "",
      rightsUri: "",
    });
  }

  return <View style={{ gap: 10 }}>
    <Text style={styles.cardTitle}>مصدر صورة المتجر</Text>
    <View style={styles.optionList}>
      <BthwaniChip disabled={disabled} label="التقطتها بنفسي" onPress={() => chooseSource("own_photo")} selected={sourceKind === "own_photo"} />
      <BthwaniChip disabled={disabled} label="قدّمها المالك" onPress={() => chooseSource("owner_provided")} selected={sourceKind === "owner_provided"} />
      <BthwaniChip disabled={disabled} label="مصدر آخر" onPress={() => chooseSource("other")} selected={sourceKind === "other"} />
    </View>
    {sourceKind && (sourceKind !== "own_photo" || !creatorName.trim()) ? <>
      <Text style={styles.label}>من التقط الصورة أو أنشأها؟</Text>
      <TextInput accessibilityLabel="اسم منشئ الصورة" editable={!disabled} maxLength={200}
        placeholder="اسم المصور أو الجهة المنشئة" placeholderTextColor={theme.colorMuted}
        style={styles.input} value={value.creator}
        onChangeText={(creator) => onChange({ ...value, creator, rightsAttested: false })} />
    </> : null}
    {sourceKind === "other" ? <>
      <Text style={styles.label}>كيف حصلت على الصورة؟</Text>
      <TextInput accessibilityLabel="وصف مصدر الصورة" editable={!disabled} maxLength={1000}
        placeholder="صف المصدر الحقيقي" placeholderTextColor={theme.colorMuted}
        style={styles.input} value={value.sourceDescription}
        onChangeText={(sourceDescription) => onChange({ ...value, sourceDescription, rightsAttested: false })} />
      <Text style={styles.label}>ما حق استخدامها؟</Text>
      <TextInput accessibilityLabel="بيان حق استخدام الصورة" editable={!disabled} maxLength={2000} multiline
        placeholder="اذكر إذن صاحب الحقوق" placeholderTextColor={theme.colorMuted}
        style={[styles.input, { minHeight: 72, paddingTop: 12, textAlignVertical: "top" }]}
        value={value.rightsStatement} onChangeText={(rightsStatement) => onChange({ ...value, rightsStatement, rightsAttested: false })} />
      <BthwaniChip disabled={disabled} label={showLinks ? "إخفاء الروابط" : "روابط المصدر أو الترخيص (اختيارية)"}
        onPress={() => setShowLinks((previous) => !previous)} selected={showLinks} />
      {showLinks ? <>
        <TextInput editable={!disabled} accessibilityLabel="رابط المصدر" keyboardType="url" autoCapitalize="none" maxLength={2048}
          placeholder="رابط المصدر" placeholderTextColor={theme.colorMuted} style={styles.input}
          value={value.sourceUri ?? ""} onChangeText={(sourceUri) => onChange({ ...value, sourceUri, rightsAttested: false })} />
        <TextInput editable={!disabled} accessibilityLabel="رابط الترخيص" keyboardType="url" autoCapitalize="none" maxLength={2048}
          placeholder="رابط الترخيص" placeholderTextColor={theme.colorMuted} style={styles.input}
          value={value.rightsUri ?? ""} onChangeText={(rightsUri) => onChange({ ...value, rightsUri, rightsAttested: false })} />
      </> : null}
    </> : null}
    {sourceKind ? <View style={styles.optionList}>
      <Switch disabled={disabled} accessibilityLabel="تأكيد حق عرض الصورة" value={value.rightsAttested}
        onValueChange={(rightsAttested) => onChange({ ...value, rightsAttested })} />
      <Text style={[styles.muted, { flex: 1 }]}>
        {sourceKind === "owner_provided"
          ? "أؤكد أن المالك سمح بعرض هذه الصورة وأن معلومات منشئها صحيحة."
          : "أؤكد صحة مصدر الصورة وامتلاك حق عرضها في بثواني."}
      </Text>
    </View> : null}
    {sourceKind && !isMediaProvenanceInputValid(value) ? <Text style={styles.muted}>اختر المصدر وأكمل البيانات المطلوبة وأكّد حق العرض لرفع الصورة.</Text> : null}
  </View>;
}
