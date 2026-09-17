import StoreDiscovery from "../../src/features/store-discovery/store-discovery";
import { ClientScrollScreen } from "../../src/shell/client-shell";

export default function ClientHomeRoute() {
  return <ClientScrollScreen><StoreDiscovery isAuthenticated /></ClientScrollScreen>;
}
