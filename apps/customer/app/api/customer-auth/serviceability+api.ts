import { handleCustomerAddresses } from "../../../src/features/addresses/address-bff.ts";

export function GET(request: Request) { return handleCustomerAddresses(request,"SERVICEABILITY"); }
