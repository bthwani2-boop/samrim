import { DshPublicError, listPublicCities } from "@bthwani/dsh";
import { useMobileAppearance } from "@bthwani/tamagui-config/appearance";
import { useCallback, useEffect, useRef, useState } from "react";
import { ActivityIndicator, Pressable, Text, View } from "react-native";
import { serviceCityLabel } from "./serviceability";

type Props = Readonly<{
  origin: string;
  currentCity: string;
  disabled?: boolean;
  onApply: (cityId: string) => void;
}>;
type Directory = {
  origin: string;
  items: string[];
  loading: boolean;
  error?: string | undefined;
  nextCursor?: string;
  revision?: number;
};

export default function ServiceCityScope({ origin, currentCity, onApply, disabled = false }: Props) {
  const { theme } = useMobileAppearance();
  const [snapshot, setDirectory] = useState<Directory>({ origin, items: [], loading: true });
  const directory: Directory = snapshot.origin === origin ? snapshot : { origin, items: [], loading: true };
  const pending = useRef<AbortController | null>(null);

  const load = useCallback(async (previous?: Directory) => {
    if (pending.current) return;
    const abort = new AbortController();
    pending.current = abort;
    const items = previous?.items ?? [];
    const nextCursor = previous?.nextCursor;
    setDirectory({ ...previous, origin, items, loading: true, error: undefined });
    try {
      const page = await listPublicCities(origin, {
        signal: abort.signal, ...(nextCursor ? { cursor: nextCursor } : {}),
      });
      if (abort.signal.aborted) return;
      if (new Set(page.items).size !== page.items.length ||
        (previous && (page.revision !== previous.revision || page.items.some(id => items.includes(id)) ||
          (page.nextCursor !== undefined && page.nextCursor === nextCursor)))) {
        throw new DshPublicError(409, "STALE_CURSOR");
      }
      setDirectory({ ...page, origin, items: [...items, ...page.items], loading: false });
    } catch (error) {
      if (abort.signal.aborted) return;
      const stale = error instanceof DshPublicError &&
        ["STALE_CURSOR", "INVALID_CURSOR", "OWNER_RESPONSE_INVALID"].includes(error.code);
      setDirectory(stale
        ? { origin, items: [], loading: false, error: "تغيّرت المدن المتاحة. حدّث القائمة." }
        : { ...previous, origin, items, loading: false, error: "تعذّر تحميل المدن المتاحة." });
    } finally {
      if (pending.current === abort) pending.current = null;
    }
  }, [origin]);

  useEffect(() => {
    void load();
    return () => {
      pending.current?.abort();
      pending.current = null;
    };
  }, [load]);

  const buttonStyle = {
    minHeight: 44, justifyContent: "center" as const, paddingHorizontal: 12,
    borderRadius: 10, borderWidth: 1, borderColor: theme.borderColor,
  };
  return (
    <View style={{ gap: 8 }}>
      <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
        {directory.items.map(id => (
          <Pressable key={id} accessibilityRole="button" accessibilityState={{ selected: id === currentCity, disabled }}
            disabled={disabled} onPress={() => { if (!disabled) onApply(id); }}
            style={{ ...buttonStyle, backgroundColor: id === currentCity ? theme.actionSoft : "transparent" }}>
            <Text style={{ color: theme.interactiveText }}>{serviceCityLabel(id)}</Text>
          </Pressable>
        ))}
      </View>
      {directory.loading ? <ActivityIndicator color={theme.interactiveText} accessibilityLabel="جارٍ تحميل المدن" /> : null}
      {directory.error ? (
        <Text accessibilityRole="alert" style={{ color: theme.dangerText }}>{directory.error}</Text>
      ) : null}
      {!directory.loading && !directory.error && directory.items.length === 0 ? (
        <Text style={{ color: theme.colorSecondary }}>لا توجد مدن متاحة للتسوّق حاليًا.</Text>
      ) : null}
      {!directory.loading && (directory.error || directory.nextCursor) ? (
        <Pressable accessibilityRole="button" disabled={disabled} onPress={() => { if (!disabled) void load(directory.nextCursor ? directory : undefined); }}
          style={{ ...buttonStyle, alignSelf: "flex-end" }}>
          <Text style={{ color: theme.interactiveText }}>
            {directory.error ? "إعادة المحاولة" : "عرض المزيد من المدن"}
          </Text>
        </Pressable>
      ) : null}
    </View>
  );
}
