import rawBaseline from "../data/repository-baseline.json" with { type: "json" };
import { parseOfficialService } from "./mohw-seed.ts";
import type { OfficialService } from "./official-source.ts";

export const REPOSITORY_BASELINE_COUNT = 12_104;
export const REPOSITORY_CORRECTION_COUNT = 11_757;

let memo: readonly OfficialService[] | null = null;

export function readRepositoryBaseline(): readonly OfficialService[] {
  if (memo) return memo;
  const root: unknown = rawBaseline;
  if (!root || typeof root !== "object" || Array.isArray(root)) {
    throw new Error("원본 저장소 보정 기준이 올바르지 않습니다.");
  }
  const record = root as Record<string, unknown>;
  const sourceCount = record.sourceCount;
  const services = Array.isArray(record.services)
    ? record.services.map(parseOfficialService).filter((service) => service !== null)
    : [];
  if (
    sourceCount !== REPOSITORY_BASELINE_COUNT ||
    services.length !== REPOSITORY_CORRECTION_COUNT
  ) {
    throw new Error("원본 저장소 12,104건 보정 기준이 완전하지 않습니다.");
  }
  memo = services;
  return memo;
}
