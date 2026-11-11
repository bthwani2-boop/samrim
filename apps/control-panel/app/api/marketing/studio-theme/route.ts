import { readStudioPublication, writeStudioPublication } from "../../../../src/server/studio-publication-route";

export const GET = (request: Request) => readStudioPublication("studio-theme", request);
export const PUT = (request: Request) => writeStudioPublication("studio-theme", request);
