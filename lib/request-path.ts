export function canonicalRequestPath(pathname: string): string {
  let decoded = pathname;
  try { decoded = decodeURI(pathname); }
  catch { return pathname; }
  return decoded.replace(/\/+/g, "/").replace(/\/+$/, "").replace(/\.rsc$/, "").replace(/\/+$/, "") || "/";
}
