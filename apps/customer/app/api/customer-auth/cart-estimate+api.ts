import { handleCustomerMerchandiseEstimate } from "../../../src/features/cart/cart-estimate-bff";

export function GET(request: Request): Promise<Response> {
  return handleCustomerMerchandiseEstimate(request);
}
