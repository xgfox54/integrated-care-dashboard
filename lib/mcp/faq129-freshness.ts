import type { Faq129Plan } from "./faq129.ts";
export const FAQ129_OUTDATED_DAYS = 365;
export interface Faq129Freshness {
  /** Legacy recency/conflict signal; CURRENT does not verify policy criteria. */
  readonly status: "CURRENT" | "OUTDATED_OR_CONFLICTING_SOURCE";
  readonly written_date: string;
  readonly age_days: number;
  readonly reasons: readonly string[];
  readonly requested_year: number | null;
  readonly excluded_years: readonly number[];
  readonly explicit_reference_years: readonly number[];
  readonly source_recency: { readonly status: "RECENT" | "OLD" | "UNKNOWN" | "FUTURE_DATE"; readonly threshold_days: number };
  readonly criteria_verification: { readonly status: "NOT_INDEPENDENTLY_VERIFIED"; readonly verified_at: null };
  readonly requested_year_verification: { readonly status: "NOT_REQUESTED" | "UNCONFIRMED" | "MENTIONED_NOT_VERIFIED" | "CONFLICTING"; readonly year: number | null };
}
export function faq129Freshness(writtenDate: string, answer: string | null, nowMs: number, currentYear?: number, scope: Pick<Faq129Plan, "requested_year" | "excluded_years"> = {}): Faq129Freshness {
  const written = Date.parse(writtenDate + "T00:00:00+09:00");
  const ageDays = Number.isFinite(written) ? Math.max(0, Math.floor((nowMs - written) / 86_400_000)) : -1;
  const year = currentYear ?? new Date(nowMs + 9 * 3_600_000).getUTCFullYear();
  const reasons: string[] = [];
  if (ageDays < 0) reasons.push("WRITTEN_DATE_UNKNOWN");
  else if (written > nowMs) reasons.push("WRITTEN_DATE_IN_FUTURE");
  else if (ageDays > FAQ129_OUTDATED_DAYS) reasons.push("WRITTEN_OVER_1_YEAR_AGO");
  const years = [...new Set([...(answer ?? "").matchAll(/(?<!\d)(20\d{2})\s*년/g)].map((match) => Number(match[1])))];
  if (years.length && Math.max(...years) < year) reasons.push("ANSWER_CITES_PRIOR_YEAR");
  const requested = scope.requested_year ?? null;
  if (requested !== null && !years.length) reasons.push("YEAR_UNCONFIRMED");
  else if (requested !== null && (years.length !== 1 || years[0] !== requested)) reasons.push("YEAR_MISMATCH");
  if (years.some((value) => scope.excluded_years?.includes(value))) reasons.push("YEAR_EXCLUDED");
  return { status: reasons.length ? "OUTDATED_OR_CONFLICTING_SOURCE" : "CURRENT", written_date: writtenDate, age_days: ageDays, reasons,
    requested_year: requested, excluded_years: scope.excluded_years ?? [], explicit_reference_years: years,
    source_recency: { status: ageDays < 0 ? "UNKNOWN" : written > nowMs ? "FUTURE_DATE" : ageDays > FAQ129_OUTDATED_DAYS ? "OLD" : "RECENT", threshold_days: FAQ129_OUTDATED_DAYS },
    criteria_verification: { status: "NOT_INDEPENDENTLY_VERIFIED", verified_at: null },
    requested_year_verification: { status: requested === null ? "NOT_REQUESTED" : reasons.includes("YEAR_MISMATCH") || reasons.includes("YEAR_EXCLUDED") ? "CONFLICTING" : years.length ? "MENTIONED_NOT_VERIFIED" : "UNCONFIRMED", year: requested },
  };
}
