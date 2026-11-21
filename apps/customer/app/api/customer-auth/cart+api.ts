import { handleCustomerCart } from "../../../src/features/cart/cart-bff";

export function GET(request: Request): Promise<Response> {
  return handleCustomerCart(request, "GET");
}

export function PUT(request: Request): Promise<Response> {
  return handleCustomerCart(request, "PUT");
}
