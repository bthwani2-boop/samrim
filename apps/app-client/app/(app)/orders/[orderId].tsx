import ClientOrderDetail from "../../../src/features/orders/order-detail";
import { ClientScrollScreen } from "../../../src/shell/client-shell";

export default function ClientOrderDetailRoute() {
  return <ClientScrollScreen><ClientOrderDetail /></ClientScrollScreen>;
}
