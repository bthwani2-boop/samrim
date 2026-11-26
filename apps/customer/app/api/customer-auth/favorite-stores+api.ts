import { handleCustomerFavorites } from "../../../src/features/discovery/favorite-stores-bff.ts";

export function GET(request: Request) { return handleCustomerFavorites(request,"GET"); }
export function PUT(request: Request) { return handleCustomerFavorites(request,"PUT"); }
