import { type Href, useLocalSearchParams, useRouter } from "expo-router";
import { useEffect, useState } from "react";
import { StyleSheet, View } from "react-native";
import { currentIdentityState } from "../../src/bootstrap/identity";
import StoreDiscovery from "../../src/features/store-discovery/store-discovery";
import { ClientPublicHeader } from "../../src/shell/client-shell";

type SearchScope = "stores" | "products";

const styles = StyleSheet.create({ root: { flex: 1 } });

export default function ClientHomeRoute() {
  const router = useRouter();
  const { focus: rawFocus, q: rawQuery, scope: rawScope } = useLocalSearchParams<{ focus?: string | string[]; q?: string | string[]; scope?: string | string[] }>();
  const routeFocus = Array.isArray(rawFocus) ? rawFocus[0] : rawFocus;
  const routeQuery = Array.isArray(rawQuery) ? rawQuery[0] ?? "" : rawQuery ?? "";
  const routeScope = Array.isArray(rawScope) ? rawScope[0] : rawScope;
  const [searchOpen, setSearchOpen] = useState(routeFocus === "search" || Boolean(routeQuery.trim()));
  const [searchQuery, setSearchQuery] = useState(routeQuery);
  const [searchScope, setSearchScope] = useState<SearchScope>(routeScope === "products" ? "products" : "stores");
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
    if (open) return;
    setSearchQuery("");
    setSearchScope("stores");
    router.replace("/home" as Href);
  }

  return (
    <View style={styles.root}>
      <ClientPublicHeader
        onSearchOpenChange={setSearchVisibility}
        onSearchQueryChange={setSearchQuery}
        searchOpen={searchOpen}
        searchQuery={searchQuery}
      />
      <StoreDiscovery
        isAuthenticated={isAuthenticated}
        onRequireAuthentication={!isAuthenticated ? () => router.replace("/?returnTo=/home" as Href) : undefined}
        onSearchQueryChange={setSearchQuery}
        onSearchScopeChange={setSearchScope}
        searchOpen={searchOpen}
        searchQuery={searchQuery}
        searchScope={searchScope}
      />
    </View>
  );
}
