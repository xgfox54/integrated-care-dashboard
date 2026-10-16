import { reviewedClassificationOf } from "./source-classifications.ts";
import type { OfficialService } from "./official-source.ts";
import { OFFICIAL_BUSINESS_TYPES } from "./business-type.ts";

export interface OfficialCoverage {
  readonly category: number;
  readonly subcategory: number;
  readonly name: number;
  readonly description: number;
  readonly target: number;
  readonly provider: number;
  readonly type: number;
}

export interface OfficialBenchmark {
  readonly sourceCount: number;
  readonly sourceCoverage: OfficialCoverage;
  readonly sourceIdentityHashes?: readonly string[];
}

export interface OfficialQualityReport {
  readonly passed: boolean;
  readonly rowCount: number;
  readonly coverage: OfficialCoverage;
  readonly baselineIdentityMatches: number;
  readonly baselineIdentityRecall: number;
  readonly invalidSubcategoryCount: number;
  readonly invalidTypeCount: number;
  readonly unclassifiedTypeCount: number;
  readonly reasons: readonly string[];
}

function present(services: readonly OfficialService[], select: (service: OfficialService) => string): number {
  return services.filter((service) => select(service).trim()).length;
}

function rate(count: number, total: number): number {
  return total > 0 ? count / total : 0;
}

function identityPart(value: string): string {
  return value.toLowerCase().replace(/[^0-9가-힣a-z]/g, "");
}

function fnv32(value: string, seed: number): string {
  let hash = seed;
  for (let index = 0; index < value.length; index += 1) {
    hash = Math.imul(hash ^ value.charCodeAt(index), 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
}

export function officialIdentityHash(
  service: Pick<OfficialService, "sido" | "sigungu" | "name">,
): string {
  const identity = [service.sido, service.sigungu, service.name].map(identityPart).join("|");
  return `${fnv32(identity, 0x811c9dc5)}${fnv32(identity, 0x9e3779b9)}`;
}

export function assessOfficialDataset(
  services: readonly OfficialService[],
  benchmark: OfficialBenchmark,
  baselineServices: readonly OfficialService[] = [],
): OfficialQualityReport {
  const coverage = {
    category: present(services, (service) => service.category),
    subcategory: present(services, (service) => service.subcategory),
    name: present(services, (service) => service.name),
    description: present(services, (service) => service.description),
    target: present(services, (service) => service.target),
    provider: present(services, (service) => service.provider),
    type: present(services, (service) => service.type),
  };
  const reasons: string[] = [];
  const minimumRows = Math.ceil(benchmark.sourceCount * 0.88);
  if (services.length < minimumRows) {
    reasons.push(`사업 수가 기준선의 88% 미만입니다(${services.length}/${benchmark.sourceCount}).`);
  }
  const coreFields: readonly [keyof OfficialCoverage, string][] = [
    ["category", "대분류"],
    ["name", "사업명"],
    ["description", "사업내용"],
    ["type", "사업구분"],
  ];
  for (const [field, label] of coreFields) {
    if (rate(coverage[field], services.length) < 0.95) reasons.push(`${label} 채움률이 95% 미만입니다.`);
  }
  const comparedFields: readonly [keyof OfficialCoverage, string][] = [
    ["subcategory", "중분류"],
    ["target", "지원대상"],
    ["provider", "제공기관"],
  ];
  for (const [field, label] of comparedFields) {
    const baselineRate = rate(benchmark.sourceCoverage[field], benchmark.sourceCount);
    if (rate(coverage[field], services.length) < Math.max(0.5, baselineRate - 0.06)) {
      reasons.push(`${label} 채움률이 기준선보다 6%p 넘게 낮습니다.`);
    }
  }
  if (services.some((service) => !service.sido.trim() || !service.sigungu.trim())) {
    reasons.push("시도 또는 시군구가 비어 있는 사업이 있습니다.");
  }
  let baselineIdentityMatches = 0;
  let baselineIdentityRecall = 0;
  if (benchmark.sourceIdentityHashes?.length) {
    const sourceIdentities = new Set(benchmark.sourceIdentityHashes);
    const extractedIdentities = new Set(services.map(officialIdentityHash));
    baselineIdentityMatches = [...extractedIdentities].filter((value) => sourceIdentities.has(value)).length;
    baselineIdentityRecall = rate(baselineIdentityMatches, sourceIdentities.size);
    if (baselineIdentityRecall < 0.7) {
      reasons.push(
        `원본 저장소 기준 사업명 보존율이 70% 미만입니다(${baselineIdentityMatches}/${sourceIdentities.size}).`,
      );
    }
  }
  let invalidSubcategoryCount = 0;
  let invalidTypeCount = 0;
  let unclassifiedTypeCount = 0;
  if (baselineServices.length > 0) {
    const baselineSubcategories = new Set(baselineServices.map((service) => service.subcategory));
    const baselineTypes = new Set([...baselineServices.map((service) => service.type), ...OFFICIAL_BUSINESS_TYPES]);
    invalidSubcategoryCount = services.filter(
      (service) => !baselineSubcategories.has(service.subcategory) && reviewedClassificationOf(service)?.subcategory?.value !== service.subcategory,
    ).length;
    invalidTypeCount = services.filter((service) => !baselineTypes.has(service.type)).length;
    if (invalidSubcategoryCount > 0) {
      reasons.push(
        `원본 저장소 기준에 없는 중분류가 ${invalidSubcategoryCount}건 포함되어 있습니다.`,
      );
    }
    if (invalidTypeCount > 0) {
      reasons.push(`원본 저장소 기준에 없는 사업구분이 ${invalidTypeCount}건 포함되어 있습니다.`);
    }
    unclassifiedTypeCount = services.filter((service) => service.type === "미분류").length;
    const baselineUnclassifiedTypeCount = baselineServices.filter(
      (service) => service.type === "미분류",
    ).length;
    if (
      rate(unclassifiedTypeCount, services.length) >
      rate(baselineUnclassifiedTypeCount, baselineServices.length) + 0.06
    ) {
      reasons.push("사업구분 미분류율이 원본 저장소 기준보다 6%p 넘게 높습니다.");
    }
  }
  return {
    passed: reasons.length === 0,
    rowCount: services.length,
    coverage,
    baselineIdentityMatches,
    baselineIdentityRecall,
    invalidSubcategoryCount,
    invalidTypeCount,
    unclassifiedTypeCount,
    reasons,
  };
}
