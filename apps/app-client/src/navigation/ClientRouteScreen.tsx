import React from "react";
import { useRouter, type Href } from "expo-router";
import {
  dshClientRouteToPath,
  type DshClientNavigation,
  type DshClientRoute,
} from "@bthwani/dsh/app-client";
import App from "../App";

export function singleRouteParam(value: string | string[] | undefined): string | undefined {
  const resolved = Array.isArray(value) ? value[0] : value;
  const normalized = resolved?.trim();
  return normalized ? normalized : undefined;
}

export function ClientRouteScreen({ route }: { readonly route: DshClientRoute }) {
  const router = useRouter();
  const navigation = React.useMemo<DshClientNavigation>(() => ({
    navigate(nextRoute, mode = "push") {
      const href = dshClientRouteToPath(nextRoute) as Href;
      if (mode === "replace") router.replace(href);
      else router.push(href);
    },
    back() {
      if (router.canGoBack()) router.back();
      else router.replace("/" as Href);
    },
  }), [router]);

  return <App route={route} navigation={navigation} />;
}
