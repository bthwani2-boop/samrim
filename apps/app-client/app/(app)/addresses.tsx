import LocationCore from "../../src/features/location-core/location-core";
import { ClientScrollScreen } from "../../src/shell/client-shell";

export default function ClientAddressesRoute() {
  return <ClientScrollScreen><LocationCore /></ClientScrollScreen>;
}
