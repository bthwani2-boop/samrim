import * as React from "react";
import { ActivityIndicator, Pressable, type PressableProps, type PressableStateCallbackType, type StyleProp, StyleSheet, Text, TextInput, type TextInputProps, View, type ViewProps, type ViewStyle } from "react-native";

import { borders, direction, elevation, opacity, radius, resolveTextAlign, resolveTextInputAlign, sizing, spacing, type ThemeColors, typography } from "../tokens/index";
import { useAppearanceTheme } from "./appearance";
import { BthwaniIcon, type MobileIconName } from "./icons";

type SurfaceTone = "base" | "raised" | "inset";

export function BthwaniSurface({ tone = "base", children, style, ...props }: ViewProps & { tone?: SurfaceTone }) {
  const theme = useAppearanceTheme();
  const styles = React.useMemo(() => createPrimitiveStyles(theme), [theme]);
  const toneStyle = tone === "raised" ? styles.surfaceRaised : tone === "inset" ? styles.surfaceInset : styles.surfaceBase;
  return <View {...props} style={[styles.surface, toneStyle, style]}>{children}</View>;
}

export function BthwaniButton({ label, variant = "primary", busy = false, disabled = false, style, ...props }: Omit<PressableProps, "children"> & { label: string; variant?: "primary" | "secondary" | "quiet"; busy?: boolean }) {
  const theme = useAppearanceTheme();
  const styles = React.useMemo(() => createPrimitiveStyles(theme), [theme]);
  const blocked = disabled || busy;
  const variantStyle = variant === "secondary" ? styles.buttonSecondary : variant === "quiet" ? styles.buttonQuiet : styles.buttonPrimary;
  const textVariantStyle = variant === "secondary" ? styles.buttonTextSecondary : variant === "quiet" ? styles.buttonTextQuiet : styles.buttonTextPrimary;
  return (
    <Pressable
      {...props}
      accessibilityState={{ ...props.accessibilityState, busy, disabled: blocked }}
      disabled={blocked}
      style={(state) => [styles.button, variantStyle, blocked && styles.buttonDisabled, state.pressed && !blocked && styles.buttonPressed, resolvePressableStyle(style, state)]}
    >
      {busy ? <ActivityIndicator color={variant === "primary" ? theme.onAction : theme.interactiveText} /> : <Text style={[styles.buttonText, textVariantStyle, blocked && styles.buttonTextDisabled]}>{label}</Text>}
    </Pressable>
  );
}

export function BthwaniIconButton({ icon, label, tone = "surface", size = sizing.controlMd, style, ...props }: Omit<PressableProps, "children"> & { icon: MobileIconName; label: string; tone?: "surface" | "soft" | "primary"; size?: number }) {
  const theme = useAppearanceTheme();
  const styles = React.useMemo(() => createPrimitiveStyles(theme), [theme]);
  const iconColor = tone === "primary" ? theme.onAction : theme.interactiveText;
  const toneStyle = tone === "soft" ? styles.iconButtonSoft : tone === "primary" ? styles.iconButtonPrimary : styles.iconButtonSurface;
  return (
    <Pressable {...props} accessibilityLabel={label} accessibilityRole={props.accessibilityRole ?? "button"} style={(state) => [styles.iconButton, toneStyle, { height: size, width: size }, state.pressed && styles.buttonPressed, resolvePressableStyle(style, state)]}>
      <BthwaniIcon name={icon} color={iconColor} size={sizing.iconMd} />
    </Pressable>
  );
}

export function BthwaniChip({ label, selected = false, icon, style, ...props }: Omit<PressableProps, "children"> & { label: string; selected?: boolean; icon?: MobileIconName }) {
  const theme = useAppearanceTheme();
  const styles = React.useMemo(() => createPrimitiveStyles(theme), [theme]);
  return (
    <Pressable {...props} accessibilityState={{ ...props.accessibilityState, selected }} style={(state) => [styles.chip, selected && styles.chipSelected, state.pressed && styles.buttonPressed, resolvePressableStyle(style, state)]}>
      {icon ? <BthwaniIcon name={icon} color={selected ? theme.interactiveText : theme.colorMuted} size={sizing.iconSm} /> : null}
      <Text style={[styles.chipText, selected && styles.chipTextSelected]}>{label}</Text>
    </Pressable>
  );
}

export function BthwaniSearchField({ value, onChangeText, placeholder, accessibilityLabel, onClear, containerStyle, ...props }: Omit<TextInputProps, "style"> & { containerStyle?: StyleProp<ViewStyle>; onClear?: (() => void) | undefined }) {
  const theme = useAppearanceTheme();
  const styles = React.useMemo(() => createPrimitiveStyles(theme), [theme]);
  const hasValue = Boolean(value);
  return (
    <View style={[styles.searchField, containerStyle]}>
      <BthwaniIcon name="search" color={theme.colorMuted} size={sizing.iconMd} />
      <TextInput {...props} accessibilityLabel={accessibilityLabel} onChangeText={onChangeText} placeholder={placeholder} placeholderTextColor={theme.colorMuted} style={styles.searchInput} value={value} />
      {hasValue && onClear ? <BthwaniIconButton icon="close" label="مسح البحث" onPress={onClear} size={sizing.controlSm} tone="soft" /> : null}
    </View>
  );
}

export function BthwaniSectionHeader({ title, subtitle, actionLabel, onAction, style }: { title: string; subtitle?: string; actionLabel?: string; onAction?: () => void; style?: StyleProp<ViewStyle> }) {
  const theme = useAppearanceTheme();
  const styles = React.useMemo(() => createPrimitiveStyles(theme), [theme]);
  return (
    <View style={[styles.sectionHeader, style]}>
      <View style={styles.sectionHeaderText}>
        <Text style={styles.sectionTitle}>{title}</Text>
        {subtitle ? <Text style={styles.sectionSubtitle}>{subtitle}</Text> : null}
      </View>
      {actionLabel && onAction ? <Pressable accessibilityRole="button" onPress={onAction} style={styles.sectionAction}><Text style={styles.sectionActionText}>{actionLabel}</Text></Pressable> : null}
    </View>
  );
}

export function BthwaniSkeleton({ width = "100%", height = sizing.controlMd, style }: { width?: number | `${number}%`; height?: number; style?: StyleProp<ViewStyle> }) {
  const theme = useAppearanceTheme();
  const styles = React.useMemo(() => createPrimitiveStyles(theme), [theme]);
  return <View accessibilityLabel="جارٍ التحميل" style={[styles.skeleton, { height, width }, style]} />;
}

function resolvePressableStyle(style: PressableProps["style"], state: PressableStateCallbackType): StyleProp<ViewStyle> {
  return typeof style === "function" ? style(state) : style;
}

function createPrimitiveStyles(theme: ThemeColors) {
  const activeDirection = direction.defaultDirection;
  const startTextAlign = resolveTextAlign("start", activeDirection);
  const startInputTextAlign = resolveTextInputAlign("start", activeDirection);
  return StyleSheet.create({
    surface: { direction: activeDirection },
    surfaceBase: { backgroundColor: theme.surface },
    surfaceRaised: { backgroundColor: theme.surfaceRaised, ...elevation.raised },
    surfaceInset: { backgroundColor: theme.surfaceInset },
    button: { alignItems: "center", borderRadius: radius.md, direction: activeDirection, justifyContent: "center", minHeight: sizing.controlLg, paddingHorizontal: spacing[4] },
    buttonPrimary: { backgroundColor: theme.actionBackground },
    buttonSecondary: { backgroundColor: theme.surface, borderColor: theme.borderColorStrong, borderWidth: borders.hairline },
    buttonQuiet: { backgroundColor: theme.actionSoft },
    buttonDisabled: { backgroundColor: theme.disabledBackground, borderColor: theme.disabledBackground },
    buttonPressed: { opacity: opacity.subtle },
    buttonText: { ...typography.bodyStrong, textAlign: "center" },
    buttonTextPrimary: { color: theme.onAction },
    buttonTextSecondary: { color: theme.color },
    buttonTextQuiet: { color: theme.interactiveText },
    buttonTextDisabled: { color: theme.disabledText },
    iconButton: { alignItems: "center", borderRadius: radius.round, direction: activeDirection, justifyContent: "center" },
    iconButtonSurface: { backgroundColor: theme.surface, borderColor: theme.borderColor, borderWidth: borders.hairline },
    iconButtonSoft: { backgroundColor: theme.actionSoft },
    iconButtonPrimary: { backgroundColor: theme.actionBackground },
    chip: { alignItems: "center", backgroundColor: theme.surface, borderColor: theme.borderColor, borderRadius: radius.round, borderWidth: borders.hairline, direction: activeDirection, flexDirection: "row", gap: spacing[1], minHeight: sizing.controlSm, paddingHorizontal: spacing[3] },
    chipSelected: { backgroundColor: theme.actionSoft, borderColor: theme.interactiveText },
    chipText: { ...typography.bodySm, color: theme.color, textAlign: "center" },
    chipTextSelected: { color: theme.interactiveText, fontWeight: "600" },
    searchField: { alignItems: "center", backgroundColor: theme.surface, borderColor: theme.borderColorStrong, borderRadius: radius.md, borderWidth: borders.hairline, direction: activeDirection, flexDirection: "row", gap: spacing[2], minHeight: sizing.controlLg, paddingHorizontal: spacing[3] },
    searchInput: { ...typography.body, color: theme.color, flex: 1, minHeight: sizing.controlLg, paddingVertical: 0, textAlign: startInputTextAlign, writingDirection: activeDirection },
    sectionHeader: { alignItems: "center", direction: activeDirection, flexDirection: "row", justifyContent: "space-between", width: "100%" },
    sectionHeaderText: { flex: 1, gap: spacing[1] },
    sectionTitle: { ...typography.titleSm, color: theme.color, textAlign: startTextAlign },
    sectionSubtitle: { ...typography.bodySm, color: theme.colorMuted, textAlign: startTextAlign },
    sectionAction: { minHeight: sizing.controlSm, justifyContent: "center", paddingHorizontal: spacing[2] },
    sectionActionText: { ...typography.bodySm, color: theme.interactiveText, textAlign: "center" },
    skeleton: { backgroundColor: theme.surfaceInset, borderRadius: radius.sm },
  });
}
