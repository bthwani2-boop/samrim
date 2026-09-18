import { borders, radius, type resolveTheme, sizing, spacing, typography } from "@bthwani/design-system";
import { StyleSheet } from "react-native";

export function createFieldOperationStyles(theme: ReturnType<typeof resolveTheme>) {
  return StyleSheet.create({
    container: { backgroundColor: theme.background, gap: spacing[4], paddingBottom: spacing[5], width: "100%" },
    title: { ...typography.hero, color: theme.color },
    sectionTitle: { ...typography.bodyStrong, color: theme.color, marginTop: spacing[1] },
    muted: { ...typography.bodySm, color: theme.colorMuted },
    state: { alignItems: "center", gap: spacing[2], paddingVertical: spacing[2] },
    card: { backgroundColor: theme.surface, borderColor: theme.borderColor, borderRadius: radius.xl, borderWidth: borders.hairline, gap: spacing[3], padding: spacing[4] },
    summaryCard: { backgroundColor: theme.actionSoft, borderRadius: radius.xl, gap: spacing[3], padding: spacing[4] },
    cardTitle: { ...typography.bodyStrong, color: theme.color },
    label: { ...typography.label, color: theme.color },
    input: { backgroundColor: theme.surface, borderColor: theme.borderColor, borderRadius: radius.sm, borderWidth: borders.hairline, color: theme.color, minHeight: sizing.controlMd, paddingHorizontal: spacing[3] },
    phoneInput: { textAlign: "left", writingDirection: "ltr" },
    optionList: { flexDirection: "row", flexWrap: "wrap", gap: spacing[2] },
    successCard: { backgroundColor: theme.successSoft, borderColor: theme.success, borderRadius: radius.sm, borderWidth: borders.hairline, gap: spacing[2], padding: spacing[2] },
    successText: { ...typography.bodyStrong, color: theme.success },
    optionsError: { gap: spacing[2] },
    error: { ...typography.label, color: theme.danger },
    orderHeader: { alignItems: "flex-start", flexDirection: "row", gap: spacing[2], justifyContent: "space-between" },
  });
}
