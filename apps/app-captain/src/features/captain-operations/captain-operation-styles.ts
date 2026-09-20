import { borders, radius, type resolveTheme, spacing, typography } from "@bthwani/design-system";
import { StyleSheet } from "react-native";

export function createCaptainOperationStyles(theme: ReturnType<typeof resolveTheme>) {
  return StyleSheet.create({
    container: { backgroundColor: theme.background, gap: spacing[4], paddingBottom: spacing[5], width: "100%" },
    title: { ...typography.hero, color: theme.color },
    sectionTitle: { ...typography.bodyStrong, color: theme.color, marginTop: spacing[1] },
    muted: { ...typography.bodySm, color: theme.colorMuted },
    state: { alignItems: "center", gap: spacing[2], paddingVertical: spacing[2] },
    card: { backgroundColor: theme.surface, borderColor: theme.borderColor, borderRadius: radius.xl, borderWidth: borders.hairline, gap: spacing[3], padding: spacing[4] },
    summaryCard: { backgroundColor: theme.actionSoft, borderRadius: radius.xl, gap: spacing[3], padding: spacing[4] },
    cardTitle: { ...typography.bodyStrong, color: theme.color },
    task: { backgroundColor: theme.surfaceInset, borderColor: theme.borderColor, borderRadius: radius.md, borderWidth: borders.hairline, gap: spacing[2], padding: spacing[3] },
    payment: { ...typography.bodySm, color: theme.interactiveText },
    input: { backgroundColor: theme.surfaceInset, borderColor: theme.borderColor, borderRadius: radius.sm, borderWidth: borders.hairline, color: theme.color, minHeight: 48, paddingHorizontal: spacing[3], textAlign: "left", writingDirection: "ltr" },
    row: { flexDirection: "row", gap: spacing[2] },
    actionButton: { flex: 1 },
    orderHeader: { alignItems: "flex-start", flexDirection: "row", gap: spacing[2], justifyContent: "space-between" },
    error: { ...typography.label, color: theme.danger },
    progress: { ...typography.bodySm, color: theme.info },
    warning: { ...typography.bodyStrong, color: theme.warning },
    warningBox: { backgroundColor: theme.warningSoft, borderColor: theme.warning, borderRadius: radius.sm, borderWidth: borders.hairline, padding: spacing[2] },
  });
}
