import { manualPlainText } from '../../lib/manuals/plain-text.ts';

export function normalizedQuote(value) {
  return String(value ?? '').normalize('NFKC').replace(/[\s\p{P}\p{S}]+/gu, '').toLowerCase();
}

export function manualQuoteMatches(excerpt, original) {
  const canonical = (text) => text.normalize('NFKC').replace(/\s+/g, ' ').trim();
  const quote = canonical(String(excerpt ?? '').replace(/^…|…$/g, ''));
  return quote.length >= 8 && canonical(manualPlainText(original)).includes(quote);
}

export function explicitEmptyScope(entry, response) {
  if (!entry.gold.explicit_unavailable_ok) return false;
  if (response.error && /MAPPING_REQUIRED|UNAVAILABLE|NOT_AVAILABLE/.test(response.error)) return true;
  const data = response.body?.data;
  return entry.tool === 'find_budget_projects' && !response.error && data?.status === 'NO_MATCHES'
    && data.reason_code === 'NO_MATCHING_PROJECTS_IN_PUBLISHED_SCOPE'
    && data.requested_fiscal_year === entry.args.fiscal_year && data.mode === entry.args.mode
    && data.requested_region_id === (entry.args.region_id ?? null)
    && Array.isArray(data.items) && data.items.length === 0
    && response.body.coverage?.total_count === 0
    && (typeof response.body.coverage?.snapshot_id === "string" || response.body.coverage?.snapshot_set?.length > 0);
}
