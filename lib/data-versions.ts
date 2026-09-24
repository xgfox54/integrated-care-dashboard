export type DataVersionKey =
  | "welfare100Lite"
  | "welfare100Extra"
  | "welfare100Items"
  | "geoBoundaries"
  | "dashboardSummary";

const VERSIONS: Readonly<Record<string, string>> =
  typeof __DATA_VERSIONS__ === "object" && __DATA_VERSIONS__ ? __DATA_VERSIONS__ : {};

/**
 * 정적 자료 주소에 빌드 때 계산한 내용 지문을 붙인다(/data/x.json?v=지문).
 * 지문이 같으면 브라우저·서비스 워커가 보관본을 그대로 쓰고, 자료가 바뀌면 주소가
 * 달라져 새 파일을 받는다.
 */
export function versionedDataUrl(path: string, key: DataVersionKey): string {
  const version = VERSIONS[key];
  return version ? path + "?v=" + version : path;
}
