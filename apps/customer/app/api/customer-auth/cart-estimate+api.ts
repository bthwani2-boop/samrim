import { handleCustomerMerchandiseEstimate } from "../../../src/features/cart/cart-estimate-bff.ts";

export function GET(request: Request): Promise<Response> {
  return handleCustomerMerchandiseEstimate(request);
}
