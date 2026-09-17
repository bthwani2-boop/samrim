import { createContext, useCallback, useContext, useEffect, useMemo, useState, type PropsWithChildren } from "react";
import * as SecureStore from "expo-secure-store";
import { ActivityIndicator, Pressable, StyleSheet, Text, View, useColorScheme } from "react-native";

import { direction, resolveRowDirection, resolveTextAlign, resolveTheme } from "@bthwani/design-system";
import type { ServiceCity } from "@bthwani/dsh";
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
  const theme = resolveTheme(useColorScheme() === "dark" ? "dark" : "light");
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
  if (state === "error") return <View style={styles.state}><Text style={styles.title}>تعذر قراءة المدن المتاحة</Text><Text style={styles.muted}>تحقق من الاتصال ثم أعد المحاولة.</Text><Pressable accessibilityRole="button" onPress={() => void refreshCities()} style={styles.button}><Text style={styles.buttonText}>إعادة المحاولة</Text></Pressable></View>;
  if (!cities.length) return <View style={styles.state}><Text style={styles.title}>لا توجد مدينة نشطة</Text><Text style={styles.muted}>سيظهر الاكتشاف بعد تفعيل مدينة من لوحة التحكم.</Text></View>;
  if (!selectedCityID) return <View style={styles.container}><Text style={styles.eyebrow}>نطاق الخدمة</Text><Text style={styles.title}>اختر مدينتك للمتابعة</Text><Text style={styles.muted}>يُستخدم الاختيار لتحديد المتاجر الظاهرة فقط، ويمكن حفظ عناوين في مدن متعددة.</Text><View style={styles.cityList}>{cities.map((city) => <Pressable key={city.id} accessibilityRole="button" accessibilityLabel={`اختيار مدينة ${city.displayNameAr}`} onPress={() => void selectCity(city.id)} style={styles.cityButton}><Text style={styles.cityName}>{city.displayNameAr}</Text><Text style={styles.cityMeta}>مدينة نشطة</Text></Pressable>)}</View></View>;

  const selectedCity = cities.find((city) => city.id === selectedCityID);
  return <ScopeContext.Provider value={value}><View style={styles.provider}><View style={styles.scopeHeader}><Text style={styles.scopeLabel}>المدينة: {selectedCity?.displayNameAr}</Text><Pressable accessibilityRole="button" accessibilityLabel="تغيير مدينة الخدمة" onPress={() => setSelectedCityID(null)}><Text style={styles.changeText}>تغيير</Text></Pressable></View>{children}</View></ScopeContext.Provider>;
}

function createStyles(theme: ReturnType<typeof resolveTheme>) {
  const activeDirection = direction.defaultDirection;
  const startTextAlign = resolveTextAlign("start", activeDirection);
  const rowDirection = resolveRowDirection(activeDirection);

  return StyleSheet.create({
    container: { backgroundColor: theme.background, gap: 12, padding: 16, width: "100%", direction: activeDirection },
    provider: { backgroundColor: theme.background, direction: activeDirection, flex: 1, width: "100%" },
    scopeHeader: { alignItems: "center", backgroundColor: theme.surface, borderColor: theme.borderColor, borderRadius: 12, borderWidth: 1, flexDirection: rowDirection, justifyContent: "space-between", margin: 12, paddingHorizontal: 12, paddingVertical: 10 },
    scopeLabel: { color: theme.color, fontSize: 13, fontWeight: "700", textAlign: startTextAlign },
    changeText: { color: theme.interactiveText, fontSize: 13, fontWeight: "800", textDecorationLine: "underline" },
    state: { alignItems: "center", backgroundColor: theme.background, gap: 12, justifyContent: "center", minHeight: 220, padding: 20, width: "100%" },
    cityList: { gap: 10, width: "100%" },
    cityButton: { backgroundColor: theme.surface, borderColor: theme.borderColor, borderRadius: 14, borderWidth: 1, gap: 4, padding: 16 },
    cityName: { color: theme.color, fontSize: 17, fontWeight: "800", textAlign: startTextAlign },
    cityMeta: { color: theme.colorMuted, fontSize: 12, textAlign: startTextAlign },
    eyebrow: { color: theme.interactiveText, fontSize: 13, fontWeight: "800", textAlign: startTextAlign },
    title: { color: theme.color, fontSize: 22, fontWeight: "800", textAlign: "center" },
    muted: { color: theme.colorMuted, fontSize: 14, lineHeight: 20, textAlign: "center" },
    button: { alignItems: "center", backgroundColor: theme.actionBackground, borderRadius: 14, minHeight: 50, justifyContent: "center", paddingHorizontal: 18 },
    buttonText: { color: theme.onAction, fontSize: 15, fontWeight: "800" },
  });
}
