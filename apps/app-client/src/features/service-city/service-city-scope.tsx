import { borders, direction, radius, resolveTextAlign, type resolveTheme, sizing, spacing, typography } from "@bthwani/design-system";
import { BthwaniButton, BthwaniIcon, useAppearanceTheme } from "@bthwani/design-system/native";
import type { ServiceCity } from "@bthwani/dsh";
import * as SecureStore from "expo-secure-store";
import { createContext, type PropsWithChildren, useCallback, useContext, useEffect, useMemo, useState } from "react";
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from "react-native";
import { listActiveServiceCities } from "./service-city-client";

const PREFERENCE_KEY = "samrim.app-client.service-city";

type ScopeContextValue = Readonly<{
  cities: ReadonlyArray<ServiceCity>;
  selectedCityID: string | null;
  selectCity: (cityID: string) => Promise<void>;
  refreshCities: () => Promise<void>;
}>;

const ScopeContext = createContext<ScopeContextValue | null>(null);

export function useServiceCityScope(): ScopeContextValue {
  const value = useContext(ScopeContext);
  if (!value) throw new Error("SERVICE_CITY_SCOPE_REQUIRED");
  return value;
}

export default function ServiceCityScope({ children }: PropsWithChildren) {
  const theme = useAppearanceTheme();
  const styles = useMemo(() => createStyles(theme), [theme]);
  const [cities, setCities] = useState<ReadonlyArray<ServiceCity>>([]);
  const [selectedCityID, setSelectedCityID] = useState<string | null>(null);
  const [state, setState] = useState<"loading" | "ready" | "error">("loading");

  const refreshCities = useCallback(async () => {
    setState("loading");
    try {
      const nextCities = await listActiveServiceCities();
      const activeIDs = new Set(nextCities.map((city) => city.id));
      const saved = (await SecureStore.getItemAsync(PREFERENCE_KEY))?.trim() || null;
      setCities(nextCities);
      setSelectedCityID(saved && activeIDs.has(saved) ? saved : null);
      if (saved && !activeIDs.has(saved)) await SecureStore.deleteItemAsync(PREFERENCE_KEY);
      setState("ready");
    } catch {
      setState("error");
    }
  }, []);

  useEffect(() => { void refreshCities(); }, [refreshCities]);

  const selectCity = useCallback(async (cityID: string) => {
    const normalized = cityID.trim();
    if (!cities.some((city) => city.id === normalized && city.active)) throw new Error("SERVICE_CITY_INVALID");
    await SecureStore.setItemAsync(PREFERENCE_KEY, normalized);
    setSelectedCityID(normalized);
  }, [cities]);

  const value = useMemo<ScopeContextValue>(() => ({ cities, selectedCityID, selectCity, refreshCities }), [cities, refreshCities, selectCity, selectedCityID]);

  if (state === "loading") return <View style={styles.state}><ActivityIndicator color={theme.actionBackground} /><Text style={styles.muted}>جارٍ قراءة نطاقات الخدمة…</Text></View>;
  if (state === "error") return <View style={styles.state}><Text style={styles.title}>تعذر قراءة المدن المتاحة</Text><Text style={styles.muted}>تحقق من الاتصال ثم أعد المحاولة.</Text><BthwaniButton label="إعادة المحاولة" onPress={() => void refreshCities()} /></View>;
  if (!cities.length) return <View style={styles.state}><Text style={styles.title}>لا توجد مدينة نشطة</Text><Text style={styles.muted}>سيظهر الاكتشاف بعد تفعيل مدينة من لوحة التحكم.</Text></View>;
  if (!selectedCityID) return <View style={styles.container}><Text style={styles.eyebrow}>نطاق الخدمة</Text><Text style={styles.title}>اختر مدينتك للمتابعة</Text><Text style={styles.muted}>يُستخدم الاختيار لتحديد المتاجر الظاهرة فقط، ويمكن حفظ عناوين في مدن متعددة.</Text><View style={styles.cityList}>{cities.map((city) => <Pressable key={city.id} accessibilityRole="button" accessibilityLabel={`اختيار مدينة ${city.displayNameAr}`} onPress={() => void selectCity(city.id)} style={styles.cityButton}><Text style={styles.cityButtonName}>{city.displayNameAr}</Text><Text style={styles.cityMeta}>مدينة نشطة</Text></Pressable>)}</View></View>;

  const selectedCity = cities.find((city) => city.id === selectedCityID);
  return <ScopeContext.Provider value={value}><View style={styles.provider}><View style={styles.scopeHeader}><View style={styles.scopeInfo}><View style={styles.locationIcon}><BthwaniIcon name="location" color={theme.interactiveText} size={sizing.iconMd} /></View><View style={styles.scopeCopy}><Text style={styles.scopeLabel}>التوصيل إلى</Text><Text style={styles.cityName}>{selectedCity?.displayNameAr}</Text></View></View><Pressable accessibilityRole="button" accessibilityLabel="تغيير مدينة الخدمة" onPress={() => setSelectedCityID(null)} style={styles.changeButton}><Text style={styles.changeText}>تغيير</Text><BthwaniIcon name="forward" color={theme.interactiveText} size={sizing.iconSm} /></Pressable></View>{children}</View></ScopeContext.Provider>;
}

function createStyles(theme: ReturnType<typeof resolveTheme>) {
  const activeDirection = direction.defaultDirection;
  const startTextAlign = resolveTextAlign("start", activeDirection);

  return StyleSheet.create({
    container: { backgroundColor: theme.background, gap: spacing[3], padding: spacing[4], width: "100%", direction: activeDirection },
    provider: { backgroundColor: theme.background, direction: activeDirection, flex: 1, width: "100%" },
    scopeHeader: { alignItems: "center", backgroundColor: theme.surface, borderColor: theme.borderColor, borderRadius: radius.md, borderWidth: borders.hairline, direction: activeDirection, flexDirection: "row", justifyContent: "space-between", margin: spacing[3], paddingHorizontal: spacing[3], paddingVertical: spacing[2] },
    scopeInfo: { alignItems: "center", direction: activeDirection, flex: 1, flexDirection: "row", gap: spacing[2] },
    locationIcon: { alignItems: "center", backgroundColor: theme.actionSoft, borderRadius: radius.round, height: sizing.controlMd, justifyContent: "center", width: sizing.controlMd },
    scopeCopy: { direction: activeDirection, gap: spacing[1] },
    scopeLabel: { ...typography.caption, color: theme.colorMuted, textAlign: startTextAlign },
    cityName: { ...typography.bodyStrong, color: theme.color, textAlign: startTextAlign },
    changeButton: { alignItems: "center", flexDirection: "row", gap: spacing[1], minHeight: sizing.controlMd, paddingHorizontal: spacing[2] },
    changeText: { ...typography.bodyStrong, color: theme.interactiveText },
    state: { alignItems: "center", backgroundColor: theme.background, gap: spacing[3], justifyContent: "center", minHeight: 220, padding: spacing[5], width: "100%" },
    cityList: { gap: spacing[2], width: "100%" },
    cityButton: { backgroundColor: theme.surface, borderColor: theme.borderColor, borderRadius: radius.md, borderWidth: borders.hairline, gap: spacing[1], padding: spacing[4] },
    cityButtonName: { ...typography.bodyLg, color: theme.color, textAlign: startTextAlign },
    cityMeta: { ...typography.caption, color: theme.colorMuted, textAlign: startTextAlign },
    eyebrow: { ...typography.label, color: theme.interactiveText, textAlign: startTextAlign },
    title: { ...typography.titleLg, color: theme.color, textAlign: "center" },
    muted: { ...typography.bodySm, color: theme.colorMuted, textAlign: "center" },
  });
}
