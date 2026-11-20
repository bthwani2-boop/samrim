import { readCurrentCustomerWallet } from "@bthwani/wlt";
import { handleWalletOwnerRead } from "../../../src/features/wallet/wallet-owner-bff";

export async function GET(request: Request): Promise<Response> {
  return handleWalletOwnerRead(request, readCurrentCustomerWallet);
}
