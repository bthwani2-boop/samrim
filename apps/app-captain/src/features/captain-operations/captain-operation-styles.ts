import { borders, direction, radius, resolveTextAlign, type resolveTheme, sizing, spacing, typography } from "@bthwani/design-system";
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
    button: { alignItems: "center", backgroundColor: theme.actionBackground, borderRadius: radius.sm, flex: 1, justifyContent: "center", minHeight: sizing.controlMd, paddingHorizontal: spacing[3] },
    buttonText: { ...typography.bodyStrong, color: theme.onAction },
    secondaryButton: { alignItems: "center", borderColor: theme.borderColor, borderRadius: radius.sm, borderWidth: borders.hairline, flex: 1, justifyContent: "center", minHeight: sizing.controlMd, paddingHorizontal: spacing[3] },
    secondaryButtonText: { ...typography.bodyStrong, color: theme.color },
    disabledButton: { backgroundColor: theme.disabledBackground, borderColor: theme.disabledBackground },
    error: { ...typography.label, color: theme.danger, textAlign: startTextAlign },
    progress: { ...typography.bodySm, color: theme.info, textAlign: startTextAlign },
    warning: { ...typography.bodyStrong, color: theme.warning, textAlign: startTextAlign },
    warningBox: { backgroundColor: theme.warningSoft, borderColor: theme.warning, borderRadius: radius.sm, borderWidth: borders.hairline, padding: spacing[2] },
  });
}
