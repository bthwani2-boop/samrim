import { type Href, useLocalSearchParams, useRouter } from "expo-router";
import { currentIdentityState } from "../../src/bootstrap/identity";
import StoreDiscovery from "../../src/features/store-discovery/store-discovery";
import { ClientScrollScreen } from "../../src/shell/client-shell";

export default function ClientHomeRoute() {
  const router = useRouter();
  const { focus } = useLocalSearchParams<{ focus?: string | string[] }>();
  const isAuthenticated = currentIdentityState().kind === "authenticated";
  return <ClientScrollScreen><StoreDiscovery autoFocusSearch={focus === "search"} isAuthenticated={isAuthenticated} onRequireAuthentication={!isAuthenticated ? () => router.replace("/?returnTo=/home" as Href) : undefined} /></ClientScrollScreen>;
}
