import { borders, direction, radius, resolveLogicalTextStyle, resolveTextInputAlign, type resolveTheme, sizing, spacing, typography } from "@bthwani/design-system";
import { StyleSheet } from "react-native";

export function createFieldOperationStyles(theme: ReturnType<typeof resolveTheme>) {
  const activeDirection = direction.defaultDirection;
  const logicalText = resolveLogicalTextStyle(activeDirection);
  const logicalInput = { textAlign: resolveTextInputAlign("start", activeDirection), writingDirection: activeDirection } as const;
  return StyleSheet.create({
    container: { backgroundColor: theme.surface, borderColor: theme.borderColor, borderRadius: radius.md, borderWidth: borders.hairline, gap: spacing[3], marginTop: spacing[4], padding: spacing[3], width: "100%", direction: activeDirection },
    title: { ...logicalText, ...typography.titleSm, color: theme.color },
    sectionTitle: { ...logicalText, ...typography.bodyStrong, color: theme.color, marginTop: spacing[1] },
    muted: { ...logicalText, ...typography.bodySm, color: theme.colorMuted },
    state: { alignItems: "center", gap: spacing[2], paddingVertical: spacing[2] },
    card: { backgroundColor: theme.surfaceRaised, borderColor: theme.borderColor, borderRadius: radius.sm, borderWidth: borders.hairline, gap: spacing[2], padding: spacing[2] },
    summaryCard: { backgroundColor: theme.actionSoft, borderRadius: radius.sm, gap: spacing[2], padding: spacing[2] },
    cardTitle: { ...logicalText, ...typography.bodyStrong, color: theme.color },
    label: { ...logicalText, ...typography.label, color: theme.color },
    input: { ...logicalInput, backgroundColor: theme.surface, borderColor: theme.borderColor, borderRadius: radius.sm, borderWidth: borders.hairline, color: theme.color, minHeight: sizing.controlMd, paddingHorizontal: spacing[3] },
    phoneInput: { textAlign: resolveTextInputAlign("start", "ltr"), writingDirection: "ltr" },
    optionList: { direction: activeDirection, flexDirection: "row", flexWrap: "wrap", gap: spacing[2] },
    successCard: { backgroundColor: theme.successSoft, borderColor: theme.success, borderRadius: radius.sm, borderWidth: borders.hairline, gap: spacing[2], padding: spacing[2] },
    successText: { ...logicalText, ...typography.bodyStrong, color: theme.success },
    optionsError: { gap: spacing[2] },
    error: { ...logicalText, ...typography.label, color: theme.danger },
  });
}
