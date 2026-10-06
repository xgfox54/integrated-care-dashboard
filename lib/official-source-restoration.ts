import type { OfficialService } from "./official-source.ts";

type SourceFields = Pick<OfficialService, "subcategory" | "type">;

// These March 2026 source rows have distinct cells that were flattened in the public snapshot.
const VERIFIED_SOURCE_DISTINCTIONS: ReadonlyMap<string, Readonly<Partial<SourceFields>>> = new Map([
  // 평택: 원문 2쪽 연번 1–6, 병합 사업명 아래의 여섯 급여 종류.
  ["0085:1489596:1:2:1", { subcategory: "방문요양" }],
  ["0085:1489596:1:2:2", { subcategory: "방문간호" }],
  ["0085:1489596:1:2:3", { subcategory: "방문목욕" }],
  ["0085:1489596:1:2:4", { subcategory: "주야간보호" }],
  ["0085:1489596:1:2:5", { subcategory: "단기보호" }],
  ["0085:1489596:1:2:6", { subcategory: "복지용구" }],
  // 울산 북구: 원문 3쪽 연번 18–23.
  ["0081:1489585:1:3:1", { subcategory: "방문요양" }],
  ["0081:1489585:1:3:2", { subcategory: "방문간호" }],
  ["0081:1489585:1:3:3", { subcategory: "방문목욕" }],
  ["0081:1489585:1:3:4", { subcategory: "주야간보호" }],
  ["0081:1489585:1:3:5", { subcategory: "단기보호" }],
  ["0081:1489585:1:3:6", { subcategory: "복지용구" }],
  // 김포·여주·용산: 같은 사업명이 서로 다른 중분류에 실린 원문 2쪽 항목.
  ["0085:1489600:1:2:7", { subcategory: "가사지원" }],
  ["0085:1489600:1:2:11", { subcategory: "이동지원" }],
  ["0085:1489615:1:2:11", { subcategory: "일상생활지원" }],
  ["0085:1489615:1:2:12", { subcategory: "가사지원" }],
  ["0075:1489541:1:2:3", { subcategory: "일상생활지원" }],
  ["0075:1489541:1:2:7", { subcategory: "가사지원" }],
  // 음성: 원문 3–6쪽 공통_연계와 6–7쪽 지역특화의 별도 수록 항목.
  ["0086:1489643:1:3:11", { type: "공통_연계" }],
  ["0086:1489643:1:6:8", { type: "지역특화" }],
  ["0086:1489643:1:3:10", { type: "공통_연계" }],
  ["0086:1489643:1:6:7", { type: "지역특화" }],
  ["0086:1489643:1:4:7", { type: "공통_연계" }],
  ["0086:1489643:1:6:9", { type: "지역특화" }],
  ["0086:1489643:1:4:3", { type: "공통_연계" }],
  ["0086:1489643:1:6:10", { type: "지역특화" }],
  ["0086:1489643:1:5:10", { type: "공통_연계" }],
  ["0086:1489643:1:7:2", { type: "지역특화" }],
  ["0086:1489643:1:6:4", { type: "공통_연계" }],
  ["0086:1489643:1:7:4", { type: "지역특화" }],
]);

export function restoreVerifiedSourceDistinctions<
  T extends Pick<OfficialService, "serviceId" | "updatedDate"> & SourceFields,
>(row: T): T {
  if (row.updatedDate !== "2026-03") return row;
  const restored = VERIFIED_SOURCE_DISTINCTIONS.get(row.serviceId);
  return restored ? { ...row, ...restored } : row;
}

/** 조회 조건과 집계에도 행 복원과 동일한 ID·기준일 범위를 적용한다. */
export function verifiedSourceFieldSql(field: keyof SourceFields): string {
  const quote = (value: string) => "'" + value.replace(/'/g, "''") + "'";
  const branches = [...VERIFIED_SOURCE_DISTINCTIONS].flatMap(([id, fields]) =>
    fields[field] === undefined ? [] : [`WHEN ${quote(id)} THEN ${quote(fields[field])}`],
  );
  return `CASE WHEN updated_date = '2026-03' THEN CASE service_id ${branches.join(" ")} ELSE ${field} END ELSE ${field} END`;
}
