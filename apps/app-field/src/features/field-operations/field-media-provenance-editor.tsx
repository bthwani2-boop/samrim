import { useAppearanceTheme } from "@bthwani/design-system/native";
import { isMediaProvenanceInputValid, type MediaProvenanceInput } from "@bthwani/dsh";
import { useMemo } from "react";
import { Switch, Text, View } from "react-native";

import { createFieldOperationStyles } from "./field-operation-styles";

// Keep provenance and permissions in DSH, not as a multi-page field form.
// Capture choice determines the claimed source; the worker must still attest.
export function FieldMediaProvenanceEditor({ value, disabled, onChange }: Readonly<{
  value: MediaProvenanceInput;
  disabled: boolean;
  onChange: (value: MediaProvenanceInput) => void;
  creatorName?: string;
}>) {
  const theme = useAppearanceTheme();
  const styles = useMemo(() => createFieldOperationStyles(theme), [theme]);
  const isCamera = value.sourceDescription.includes("كاميرته");
  return <View style={{ gap: 6 }}>
    <View style={[styles.optionList, { alignItems: "center" }]}>
      <Switch
        accessibilityLabel="تأكيد حق عرض صورة واجهة المتجر"
        disabled={disabled}
        value={value.rightsAttested}
        onValueChange={(rightsAttested) => onChange({ ...value, rightsAttested })}
      />
      <Text style={[styles.muted, { flex: 1 }]}>
        {isCamera
          ? "أؤكد موافقة مالك المتجر على عرض الصورة التي التقطتها."
          : "أؤكد أن مالك المتجر قدّم الصورة ويملك حق عرضها."}
      </Text>
    </View>
    {!isMediaProvenanceInputValid(value) ? <Text style={styles.muted}>أكّد حق عرض الصورة قبل حفظها.</Text> : null}
  </View>;
}
