// Keep the Expo Router API path stable; the admission feature owns its browser transport.
import { GET as readAdmission } from "../../src/features/access/browser-admission-read.ts";
import { DELETE as deleteAdmission, PATCH as patchAdmission, POST as postAdmission } from "../../src/features/access/browser-admission-write.ts";

import { catalogImportAdmission } from "../../src/features/access/browser-catalog-import.ts";

const isImport = (request:Request) => new URL(request.url).searchParams.has("catalogImport");
export async function GET(request: Request) { return isImport(request) ? catalogImportAdmission(request) : readAdmission(request); }
export async function PUT(request: Request) { return catalogImportAdmission(request); }
export async function PATCH(request: Request) { return isImport(request) ? catalogImportAdmission(request) : patchAdmission(request); }
export async function POST(request: Request) { return postAdmission(request); }
export async function DELETE(request: Request) { return deleteAdmission(request); }
