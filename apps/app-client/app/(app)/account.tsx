import ClientAccount from "../../src/features/account/account";
import { ClientScrollScreen } from "../../src/shell/client-shell";

export default function ClientAccountRoute() {
  return <ClientScrollScreen><ClientAccount /></ClientScrollScreen>;
}
