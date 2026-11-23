// Keep the Expo Router API path stable; the admission feature owns its browser transport.
import { GET as readAdmission } from "../../src/features/access/browser-admission-read.ts";
import { DELETE as deleteAdmission, PATCH as patchAdmission, POST as postAdmission } from "../../src/features/access/browser-admission-write.ts";

export async function GET(request: Request) { return readAdmission(request); }
export async function PATCH(request: Request) { return patchAdmission(request); }
export async function POST(request: Request) { return postAdmission(request); }
export async function DELETE(request: Request) { return deleteAdmission(request); }
