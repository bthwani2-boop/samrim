import { DshPublicError, listPublicCities } from "@bthwani/dsh";
import { useMobileAppearance } from "@bthwani/tamagui-config/appearance";
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
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

function emptyDirectory(origin: string): Directory {
  return { origin, items: [], loading: true };
}

function invalidSnapshot(error: unknown): boolean {
  return error instanceof DshPublicError &&
    ["STALE_CURSOR", "INVALID_CURSOR", "OWNER_RESPONSE_INVALID"].includes(error.code);
}

export default function ServiceCityScope({ origin, currentCity, onApply, disabled = false }: Props) {
  const { theme } = useMobileAppearance();
  const [snapshot, setSnapshot] = useState<Directory>(emptyDirectory(origin));
  const directory = snapshot.origin === origin ? snapshot : emptyDirectory(origin);
  const pending = useRef<AbortController | null>(null);
  // Only the latest committed view may dispatch. Revocation applies to every
  // choice and continuation, including after origin changes and unmount.
  const view = { directory, currentCity, disabled, onApply };
  const committed = useRef<typeof view | null>(null);
  useLayoutEffect(() => {
    committed.current = view;
    return () => { committed.current = null; };
  });
  const canAct = () => committed.current === view && !view.disabled;

  const load = useCallback(async (previous?: Directory) => {
    if (pending.current) return;
    const request = new AbortController();
    pending.current = request;
    const items = previous?.items ?? [];
    const cursor = previous?.nextCursor;
    setSnapshot({ ...previous, origin, items, loading: true, error: undefined });
    try {
      const page = await listPublicCities(origin, {
        signal: request.signal, ...(cursor ? { cursor } : {}),
      });
      if (request.signal.aborted || pending.current !== request) return;
      const repeated = page.nextCursor !== undefined && page.nextCursor === cursor;
      if (new Set(page.items).size !== page.items.length ||
        (previous && (page.revision !== previous.revision || repeated || page.items.some(id => items.includes(id))))) {
        throw new DshPublicError(409, "STALE_CURSOR");
      }
      setSnapshot({ ...page, origin, items: [...items, ...page.items], loading: false });
    } catch (error) {
      if (request.signal.aborted || pending.current !== request) return;
      setSnapshot(invalidSnapshot(error)
        ? { origin, items: [], loading: false, error: "تغيّرت المدن المتاحة. حدّث القائمة." }
        : { ...previous, origin, items, loading: false, error: "تعذّر تحميل المدن المتاحة." });
    } finally {
      if (pending.current === request) pending.current = null;
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
      <View accessibilityRole="radiogroup" accessibilityLabel="المدينة"
        style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
        {directory.items.map(id => {
          const checked = id === currentCity;
          const label = serviceCityLabel(id);
          return (
            <Pressable key={id} accessibilityRole="radio" accessibilityLabel={label}
              aria-checked={checked} accessibilityState={{ checked, disabled }}
              disabled={disabled} onPress={() => { if (canAct()) onApply(id); }}
              style={{ ...buttonStyle, backgroundColor: checked ? theme.actionSoft : "transparent" }}>
              <Text style={{ color: theme.interactiveText }}>{label}</Text>
            </Pressable>
          );
        })}
      </View>
      {directory.loading ? <ActivityIndicator color={theme.interactiveText} accessibilityLabel="جارٍ تحميل المدن" /> : null}
      {directory.error ? (
        <Text accessibilityRole="alert" style={{ color: theme.dangerText }}>{directory.error}</Text>
      ) : null}
      {!directory.loading && !directory.error && directory.items.length === 0 ? (
        <Text style={{ color: theme.colorSecondary }}>لا توجد مدن متاحة للتسوّق حاليًا.</Text>
      ) : null}
      {!directory.loading && (directory.error || directory.nextCursor) ? (
        <Pressable accessibilityRole="button" disabled={disabled}
          onPress={() => { if (canAct()) void load(directory.nextCursor ? directory : undefined); }}
          style={{ ...buttonStyle, alignSelf: "flex-end" }}>
          <Text style={{ color: theme.interactiveText }}>
            {directory.error ? "إعادة المحاولة" : "عرض المزيد من المدن"}
          </Text>
        </Pressable>
      ) : null}
    </View>
  );
}
