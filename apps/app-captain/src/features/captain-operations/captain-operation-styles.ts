import { borders, direction, radius, resolveTextAlign, type resolveTheme, spacing, typography } from "@bthwani/design-system";
import { StyleSheet } from "react-native";

export function createCaptainOperationStyles(theme: ReturnType<typeof resolveTheme>) {
  const activeDirection = direction.defaultDirection;
  const startTextAlign = resolveTextAlign("start", activeDirection);
  return StyleSheet.create({
    container: { backgroundColor: theme.surface, borderColor: theme.borderColor, borderRadius: radius.md, borderWidth: borders.hairline, gap: spacing[3], marginTop: spacing[4], padding: spacing[3], width: "100%", direction: activeDirection },
    title: { ...typography.titleSm, color: theme.color, textAlign: startTextAlign },
    sectionTitle: { ...typography.bodyStrong, color: theme.color, marginTop: spacing[1], textAlign: startTextAlign },
    muted: { ...typography.bodySm, color: theme.colorMuted, textAlign: startTextAlign },
    state: { alignItems: "center", gap: spacing[2], paddingVertical: spacing[2] },
    card: { backgroundColor: theme.surfaceRaised, borderColor: theme.borderColor, borderRadius: radius.sm, borderWidth: borders.hairline, gap: spacing[2], padding: spacing[2] },
    summaryCard: { backgroundColor: theme.actionSoft, borderRadius: radius.sm, gap: spacing[2], padding: spacing[2] },
    cardTitle: { ...typography.bodyStrong, color: theme.color, textAlign: startTextAlign },
    task: { borderColor: theme.borderColor, borderRadius: radius.sm, borderWidth: borders.hairline, gap: spacing[1], padding: spacing[2] },
    row: { direction: activeDirection, flexDirection: "row", gap: spacing[2] },
    actionButton: { flex: 1 },
    error: { ...typography.label, color: theme.danger, textAlign: startTextAlign },
    progress: { ...typography.bodySm, color: theme.info, textAlign: startTextAlign },
    warning: { ...typography.bodyStrong, color: theme.warning, textAlign: startTextAlign },
    warningBox: { backgroundColor: theme.warningSoft, borderColor: theme.warning, borderRadius: radius.sm, borderWidth: borders.hairline, padding: spacing[2] },
  });
}
