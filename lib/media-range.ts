type AssetFetcher = { fetch(request: Request): Promise<Response> };

const BYTE_RANGE = /^bytes=(\d*)-(\d*)$/;

export type ByteRange = { start: number; end: number } | "unsatisfiable" | null;

export function parseByteRange(header: string | null, size: number): ByteRange {
  const match = BYTE_RANGE.exec(header?.trim() ?? "");
  if (!match || (!match[1] && !match[2])) return null;
  if (!match[1]) {
    const suffix = Number(match[2]);
    if (suffix === 0) return "unsatisfiable";
    return { start: Math.max(0, size - suffix), end: size - 1 };
  }
  const start = Number(match[1]);
  const end = match[2] ? Math.min(Number(match[2]), size - 1) : size - 1;
  if (start >= size || start > end) return "unsatisfiable";
  return { start, end };
}

// The hosting layer serves public files before the Worker and ignores Range, which iOS Safari requires for <video>.
export async function serveRangedAsset(request: Request, assets: AssetFetcher, assetPath: string, contentType: string): Promise<Response> {
  const source = await assets.fetch(new Request(new URL(assetPath, request.url)));
  if (!source.ok) return new Response("Not found", { status: 404, headers: { "cache-control": "no-store" } });
  const body = new Uint8Array(await source.arrayBuffer());
  const headers = new Headers({ "content-type": contentType, "accept-ranges": "bytes", "cache-control": "public, max-age=86400" });
  const etag = source.headers.get("etag");
  if (etag) headers.set("etag", etag);
  const range = parseByteRange(request.headers.get("range"), body.byteLength);
  if (range === "unsatisfiable") {
    headers.set("content-range", "bytes */" + body.byteLength);
    return new Response(null, { status: 416, headers });
  }
  const chunk = range ? body.subarray(range.start, range.end + 1) : body;
  headers.set("content-length", String(chunk.byteLength));
  if (range) headers.set("content-range", "bytes " + range.start + "-" + range.end + "/" + body.byteLength);
  return new Response(request.method === "HEAD" ? null : chunk, { status: range ? 206 : 200, headers });
}

