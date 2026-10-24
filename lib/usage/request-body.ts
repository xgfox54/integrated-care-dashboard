import { readBoundedBody, RequestBodyError } from "../request-body.ts";
import { MAX_REQUEST_BYTES } from "./codes.ts";

export async function readUsageBody(request: Request): Promise<string | null> {
  let bytes: Uint8Array;
  try {
    bytes = await readBoundedBody(request, { maxBytes: MAX_REQUEST_BYTES });
  } catch (error) {
    if (error instanceof RequestBodyError) return null;
    throw error;
  }
  if (bytes.byteLength === 0) return null;
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch (error) {
    if (error instanceof TypeError) return null;
    throw error;
  }
}
