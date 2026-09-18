import { direction, radius, resolveTextAlign, type resolveTheme, spacing, typography } from "@bthwani/design-system";
import { StyleSheet } from "react-native";

export function createPartnerSurfaceStyles(theme: ReturnType<typeof resolveTheme>) {
  const activeDirection = direction.defaultDirection;
  const startTextAlign = resolveTextAlign("start", activeDirection);
  return StyleSheet.create({
    container: { direction: activeDirection, gap: spacing[2], width: "100%" },
    state: { alignItems: "center", direction: activeDirection, gap: spacing[2], paddingVertical: spacing[4], width: "100%" },
    sectionTitle: { ...typography.bodyStrong, color: theme.color, textAlign: startTextAlign },
    value: { ...typography.bodyStrong, color: theme.color, textAlign: startTextAlign },
    muted: { ...typography.bodySm, color: theme.colorMuted, textAlign: startTextAlign },
    error: { ...typography.label, backgroundColor: theme.dangerSoft, borderRadius: radius.sm, color: theme.danger, padding: spacing[2], textAlign: startTextAlign },
  });
}
