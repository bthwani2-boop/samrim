import { borders, radius, type resolveTheme, spacing, typography } from "@bthwani/design-system";
import { StyleSheet } from "react-native";

export function createPartnerSurfaceStyles(theme: ReturnType<typeof resolveTheme>) {
  return StyleSheet.create({
    container: { backgroundColor: theme.background, gap: 8, paddingBottom: 10, width: "100%" },
    state: { alignItems: "center", gap: 6, paddingVertical: 8, width: "100%" },
    sectionTitle: { ...typography.titleSm, color: theme.color },
    value: { ...typography.bodyStrong, color: theme.color },
    muted: { ...typography.bodySm, color: theme.colorMuted },
    card: { backgroundColor: theme.surface, borderColor: theme.borderColor, borderRadius: radius.md, borderWidth: 1, gap: 8, padding: 11 },
    headerRow: { alignItems: "center", flexDirection: "row", gap: 8, justifyContent: "space-between", minHeight: 34 },
    headerCopy: { flex: 1, gap: spacing[1] },
    metaGrid: { flexDirection: "row", gap: spacing[2] },
    metaItem: { backgroundColor: theme.surfaceInset, borderRadius: radius.md, flex: 1, gap: 3, padding: 9 },
    metaLabel: { ...typography.caption, color: theme.colorMuted },
    formInput: { backgroundColor: theme.surfaceInset, borderColor: theme.borderColor, borderRadius: radius.md, borderWidth: borders.hairline, color: theme.color, minHeight: 42, paddingHorizontal: spacing[3], textAlign: "right" },
    choiceRow: { flexDirection: "row", flexWrap: "wrap", gap: spacing[2] },
    choice: { backgroundColor: theme.surfaceInset, borderColor: theme.borderColor, borderRadius: radius.md, borderWidth: borders.hairline, justifyContent: "center", minHeight: 40, paddingHorizontal: spacing[3], paddingVertical: spacing[2] },
    choiceSelected: { backgroundColor: theme.actionSoft, borderColor: theme.actionBackground },
    choiceText: { ...typography.bodySm, color: theme.color },
    choiceTextSelected: { ...typography.bodySm, color: theme.interactiveText },
    error: { ...typography.label, backgroundColor: theme.dangerSoft, borderRadius: radius.sm, color: theme.danger, padding: spacing[2] },
  });
}
