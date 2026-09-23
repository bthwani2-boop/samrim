import { radius, spacing, typography } from "@bthwani/design-system";
import { BthwaniButton, useAppearanceTheme } from "@bthwani/design-system/native";
import type { StoreFulfillmentMode, StoreFulfillmentModesResponse } from "@bthwani/dsh";
import { useMemo, useState } from "react";
import { Pressable, Text, View } from "react-native";
import { createPartnerSurfaceStyles } from "./partner-surface-styles";
import { updateOwnStoreFulfillmentModes } from "./store-readback-client";

const selectableModes: ReadonlyArray<StoreFulfillmentMode> = ["BTHWANI_CAPTAIN", "CUSTOMER_PICKUP"];

type SaveFailure = "conflict" | "uncertain" | "generic";

type StoreFulfillmentModeSettingsProps = Readonly<{
  storeID: string;
  version: number;
  savedModes: ReadonlyArray<StoreFulfillmentMode>;
  onSaved: (result: StoreFulfillmentModesResponse) => void;
  onReload: () => void;
}>;

export function StoreFulfillmentModeSettings({ storeID, version, savedModes, onSaved, onReload }: StoreFulfillmentModeSettingsProps) {
  const theme = useAppearanceTheme();
  const styles = useMemo(() => createPartnerSurfaceStyles(theme), [theme]);
  const [selectedModes, setSelectedModes] = useState<ReadonlyArray<StoreFulfillmentMode>>(savedModes);
  const [saving, setSaving] = useState(false);
  const [failure, setFailure] = useState<SaveFailure | null>(null);

  const changed = selectableModes.some((mode) => selectedModes.includes(mode) !== savedModes.includes(mode));

  function toggleMode(mode: StoreFulfillmentMode) {
    setFailure(null);
    setSelectedModes((current) => {
      const hasMode = current.includes(mode);
      if (hasMode && current.length === 1) return current;
      const next = new Set(current);
      if (hasMode) next.delete(mode);
      else next.add(mode);
      return selectableModes.filter((candidate) => next.has(candidate));
    });
  }

  async function save() {
    if (!changed || saving || selectedModes.length === 0) return;
    setSaving(true);
    setFailure(null);
    try {
      const result = await updateOwnStoreFulfillmentModes(storeID, selectedModes, version);
      setSelectedModes(result.fulfillmentModes);
      onSaved(result);
    } catch (error) {
      const candidate = error as { kind?: unknown; code?: unknown };
      if (candidate?.kind === "network") setFailure("uncertain");
      else if (candidate?.code === "VERSION_CONFLICT") setFailure("conflict");
      else setFailure("generic");
    } finally {
      setSaving(false);
    }
  }

  const failureText = failure === "conflict"
    ? "تغيّرت بيانات المتجر. أعد قراءتها قبل حفظ الاختيارات الجديدة."
    : failure === "uncertain"
      ? "تعذّر تأكيد نتيجة الحفظ. أعد قراءة المتجر للتحقق قبل المحاولة مرة أخرى."
      : failure === "generic"
        ? "تعذّر حفظ طرق الاستلام. راجع الاختيارات وحاول مجددًا."
        : "";

  return (
    <View style={styles.card}>
      <Text style={styles.value}>طرق استلام الطلبات</Text>
      <Text style={styles.muted}>اختر طريقة واحدة على الأقل. تؤثر التغييرات على الطلبات الجديدة فقط.</Text>
      {selectableModes.map((mode) => {
        const checked = selectedModes.includes(mode);
        const cannotRemoveLast = checked && selectedModes.length === 1;
        const label = mode === "BTHWANI_CAPTAIN" ? "توصيل بثواني" : "الاستلام من المتجر";
        const description = mode === "BTHWANI_CAPTAIN"
          ? "يتولى كابتن بثواني توصيل الطلب إلى العميل."
          : "يستلم العميل الطلب من المتجر ويدفع قيمته نقدًا للمتجر.";
        return (
          <Pressable
            key={mode}
            accessibilityRole="checkbox"
            accessibilityLabel={label}
            accessibilityHint={description}
            accessibilityState={{ checked, disabled: saving || cannotRemoveLast }}
            disabled={saving || cannotRemoveLast}
            onPress={() => toggleMode(mode)}
            style={({ pressed }) => ({
              alignItems: "center",
              backgroundColor: checked ? theme.surfaceInset : theme.surface,
              borderColor: checked ? theme.actionBackground : theme.borderColor,
              borderRadius: radius.md,
              borderWidth: checked ? 2 : 1,
              flexDirection: "row",
              gap: spacing[3],
              minHeight: 64,
              opacity: pressed ? 0.72 : 1,
              padding: spacing[3],
            })}
          >
            <View style={{ flex: 1, gap: spacing[1] }}>
              <Text style={{ ...typography.label, color: theme.color, textAlign: "right" }}>{label}</Text>
              <Text style={styles.muted}>{description}</Text>
            </View>
            <View
              accessibilityElementsHidden
              importantForAccessibility="no-hide-descendants"
              style={{
                alignItems: "center",
                borderColor: checked ? theme.actionBackground : theme.borderColor,
                borderRadius: 12,
                borderWidth: 1,
                height: 28,
                justifyContent: "center",
                width: 28,
              }}
            >
              <Text style={{ color: theme.actionBackground, ...typography.label }}>{checked ? "✓" : ""}</Text>
            </View>
          </Pressable>
        );
      })}
      {failureText ? <Text accessibilityRole="alert" style={styles.error}>{failureText}</Text> : null}
      {failure === "conflict" || failure === "uncertain" ? <BthwaniButton disabled={saving} label="إعادة قراءة المتجر" onPress={onReload} variant="secondary" /> : null}
      <BthwaniButton busy={saving} disabled={!changed || saving} label="حفظ طرق الاستلام" onPress={() => void save()} />
    </View>
  );
}
