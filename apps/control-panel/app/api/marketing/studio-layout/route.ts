import { readStudioPublication, writeStudioPublication } from "../../../../src/server/studio-publication-route";

export const GET = (request: Request) => readStudioPublication("studio-layout", request);
export const PUT = (request: Request) => writeStudioPublication("studio-layout", request);
