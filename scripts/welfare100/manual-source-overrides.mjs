import { createHash } from "node:crypto";
import { lineFingerprint } from "./manual-link-scope.mjs";
import { displayLines } from "./manual-pages.mjs";

export function resolveManualSourceOverride(override, { manualLines, pages, locate, fallback }) {
  const page = pages.find((page) => page.file === override.file && page.page === override.page);
  if (!page || createHash("sha256").update(page.raw).digest("hex") !== override.page_sha256) throw new Error(`Manual source page fingerprint changed: ${override.item}/${override.source_key}`);
  if (override.section_line && lineFingerprint(manualLines.get(override.key)?.[override.section_line - 1]) !== override.line_sha256) throw new Error(`Manual source line fingerprint changed: ${override.item}/${override.source_key}`);
  if (override.quote && (!displayLines(page.raw).join("\n").includes(override.quote) || createHash("sha256").update(override.quote).digest("hex") !== override.quote_sha256)) throw new Error(`Manual source quote fingerprint changed: ${override.item}/${override.source_key}`);
  const found = override.section_line ? locate(override.key, override.section_line, []) : fallback();
  if (found.original?.file !== override.file || found.original?.page !== override.page) throw new Error(`Manual source mapping changed: ${override.item}/${override.source_key}`);
  return { ...found, original: { ...found.original, ...(override.quote ? { quote: override.quote } : {}) } };
}
