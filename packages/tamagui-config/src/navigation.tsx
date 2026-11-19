import { useEffect, useState } from "react";
import { Platform, StyleSheet, Text, useWindowDimensions } from "react-native";
import { useMobileAppearance } from "./appearance";
import { usesDesktopNavigation } from "./navigation-mode";

export function usePrimaryNavigation() {
  const { theme } = useMobileAppearance();
  const { width } = useWindowDimensions();
  const [hydrated, setHydrated] = useState(false);
  // SSR and the first web render must use the same navigator geometry.
  useEffect(() => setHydrated(true), []);
  const desktop = hydrated && usesDesktopNavigation(Platform.OS, width);

  return {
    desktop,
    screenOptions: {
      headerShown: false,
      // Expo puts the "left" rail first in the row, on the right in RTL Web.
      tabBarPosition: desktop ? "left" : "bottom",
      tabBarVariant: desktop ? "material" : "uikit",
      tabBarLabelPosition: "beside-icon",
      tabBarHideOnKeyboard: true,
      tabBarActiveBackgroundColor: theme.actionSoft,
      tabBarActiveTintColor: theme.interactiveText,
      tabBarInactiveTintColor: theme.colorSecondary,
      tabBarIcon: () => null,
      tabBarIconStyle: { display: "none" },
      tabBarLabel: ({ children, focused }: { children: string; focused: boolean }) => (
        <Text style={{
          color: focused ? theme.interactiveText : theme.colorSecondary,
          fontSize: 14,
          fontWeight: "600",
          textDecorationLine: focused ? "underline" : "none",
        }}>
          {children}
        </Text>
      ),
      tabBarItemStyle: desktop ? { minHeight: 48 } : { minWidth: 48 },
      tabBarStyle: desktop
        ? {
          width: 224,
          minWidth: 224,
          backgroundColor: theme.surface,
          borderColor: theme.borderColor,
          borderLeftWidth: StyleSheet.hairlineWidth,
          borderRightWidth: 0,
        }
        : { backgroundColor: theme.surface, borderTopColor: theme.borderColor },
      sceneStyle: { backgroundColor: theme.background },
    } as const,
  };
}
