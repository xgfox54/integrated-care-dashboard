import { SERVICE_CATEGORY_ORDER } from "./dataset.ts";
import { DEFAULT_SEARCH_PAGE_SIZE, SEARCH_PAGE_SIZES } from "./dataset-summary.ts";
import {
  bundlePerPart,
  MAX_BUNDLE_PER,
  type BundleScope,
} from "./region-load-order.ts";
import { hasOnlyUniqueQueryKeys } from "./query-boundary.ts";

const SIDO_KEYS = ["scope", "size", "category"] as const;
const SIGUNGU_KEYS = ["scope", "part", "per", "size", "category"] as const;

export interface BundleRequest {
  readonly scope: BundleScope;
  readonly part: number;
  readonly per: number;
  readonly pageSize: number;
  readonly category: string;
}

function integerParam(value: string | null): number | null {
  if (value === null || value.trim() === "") return null;
  const parsed = Number(value);
  return Number.isInteger(parsed) ? parsed : null;
}

function allowedPageSize(value: number): boolean {
  return SEARCH_PAGE_SIZES.includes(value as (typeof SEARCH_PAGE_SIZES)[number]);
}

export function parseBundleRequest(params: URLSearchParams): BundleRequest | null {
  const scope = params.get("scope");
  if (scope !== "sido" && scope !== "sigungu") return null;
  if (!hasOnlyUniqueQueryKeys(params, scope === "sido" ? SIDO_KEYS : SIGUNGU_KEYS)) return null;

  const requestedSize = integerParam(params.get("size"));
  const pageSize = requestedSize ?? DEFAULT_SEARCH_PAGE_SIZE;
  if (!allowedPageSize(pageSize)) return null;

  const category = (params.get("category") ?? "").trim();
  if (category && !SERVICE_CATEGORY_ORDER.includes(category as (typeof SERVICE_CATEGORY_ORDER)[number])) return null;
  if (scope === "sido") return { scope, part: 0, per: 0, pageSize, category };

  const part = integerParam(params.get("part"));
  if (part === null || part < 0 || part > 1000) return null;
  const requestedPer = integerParam(params.get("per"));
  const per = requestedPer ?? bundlePerPart(pageSize);
  if (per < 1 || per > MAX_BUNDLE_PER) return null;
  return { scope, part, per, pageSize, category };
}
