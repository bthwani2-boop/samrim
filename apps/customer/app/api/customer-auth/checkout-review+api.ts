import { handleCustomerCheckoutReview } from "../../../src/features/checkout/checkout-review-bff.ts";
export function POST(request: Request): Promise<Response> {
  return handleCustomerCheckoutReview(request);
}
