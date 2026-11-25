import { handleCustomerCartDirectory } from "../../../src/features/cart/cart-directory-bff.ts";

export function GET(request:Request){return handleCustomerCartDirectory(request);}