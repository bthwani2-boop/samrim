import { type Href, useFocusEffect, useLocalSearchParams, useRouter } from "expo-router";
import { useCallback, useEffect, useState } from "react";
import { StyleSheet, View } from "react-native";
import { StatusBar } from "expo-status-bar";
import { runOnJS, useAnimatedReaction, useSharedValue } from "react-native-reanimated";
import { currentIdentityState } from "../../src/bootstrap/identity";
import StoreDiscovery from "../../src/features/store-discovery/store-discovery";
import { ClientPublicHeader } from "../../src/shell/client-shell";

type SearchScope = "stores" | "products";

const styles = StyleSheet.create({ root: { flex: 1 }, stickyHeaderOverlay: { position: "absolute", top: 0, left: 0, right: 0, zIndex: 30 } });

export default function ClientHomeRoute() {
  const router = useRouter();
  const [compactHeader, setCompactHeader] = useState(false);
  const homeScrollOffset = useSharedValue(0);
  useAnimatedReaction(() => homeScrollOffset.value > 410, (isCompact, previous) => {
    if (isCompact !== previous) runOnJS(setCompactHeader)(isCompact);
  });
  const { focus: rawFocus, q: rawQuery, scope: rawScope } = useLocalSearchParams<{ focus?: string | string[]; q?: string | string[]; scope?: string | string[] }>();
  const routeFocus = Array.isArray(rawFocus) ? rawFocus[0] : rawFocus;
  const routeQuery = Array.isArray(rawQuery) ? rawQuery[0] ?? "" : rawQuery ?? "";
  const routeScope = Array.isArray(rawScope) ? rawScope[0] : rawScope;
  const [searchOpen, setSearchOpen] = useState(routeFocus === "search" || Boolean(routeQuery.trim()));
  const [searchQuery, setSearchQuery] = useState(routeQuery);
  const [searchScope, setSearchScope] = useState<SearchScope>(routeScope === "products" ? "products" : "stores");
  const [screenActive, setScreenActive] = useState(false);
  useFocusEffect(useCallback(() => { setScreenActive(true); return () => setScreenActive(false); }, []));
  const isAuthenticated = currentIdentityState().kind === "authenticated";
  useEffect(() => {
    if (routeFocus === "search" || routeQuery.trim()) {
      setSearchOpen(true);
      setSearchQuery(routeQuery);
      setSearchScope(routeScope === "products" ? "products" : "stores");
    } else if (routeFocus !== undefined) {
      setSearchOpen(false);
      setSearchQuery("");
      setSearchScope("stores");
    }
  }, [routeFocus, routeQuery, routeScope]);

  function setSearchVisibility(open: boolean) {
    setSearchOpen(open);
    if (open) { setSearchScope("products"); return; }
    setSearchQuery("");
    setSearchScope("stores");
    router.replace("/home" as Href);
  }

  return (
    <View style={styles.root}>
      <StatusBar style={compactHeader ? "dark" : "light"} />
      {(searchOpen || compactHeader) ? <View style={!searchOpen && compactHeader ? styles.stickyHeaderOverlay : undefined}><ClientPublicHeader
        homeVariant
        homeCompact={compactHeader}
        hideAccountAction
        onSearchOpenChange={setSearchVisibility}
        onSearchQueryChange={setSearchQuery}
        searchOpen={searchOpen}
        searchQuery={searchQuery}
      /></View> : null}
      <StoreDiscovery
        isScreenActive={screenActive}
        heroHeader={!searchOpen ? <ClientPublicHeader homeVariant homeTransparent hideAccountAction onSearchOpenChange={setSearchVisibility} onSearchQueryChange={setSearchQuery} searchOpen={searchOpen} searchQuery={searchQuery} /> : undefined}
        homeScrollOffset={homeScrollOffset}
        isAuthenticated={isAuthenticated}
        onRequireAuthentication={!isAuthenticated ? () => router.replace("/?returnTo=/home" as Href) : undefined}
        onSearchOpenChange={setSearchVisibility}
        onSearchQueryChange={setSearchQuery}
        onSearchScopeChange={setSearchScope}
        searchOpen={searchOpen}
        searchQuery={searchQuery}
        searchScope={searchScope}
      />
    </View>
  );
}
