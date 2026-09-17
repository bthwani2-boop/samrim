import ClientOrders from "../../src/features/orders/orders";
import { ClientScrollScreen } from "../../src/shell/client-shell";

export default function ClientOrdersRoute() {
  return <ClientScrollScreen><ClientOrders /></ClientScrollScreen>;
}
