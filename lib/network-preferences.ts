interface NetworkInformationLike {
  readonly saveData?: boolean;
}

/**
 * 사용자가 브라우저·휴대폰에서 데이터 절약 모드를 켰는지. 켜져 있으면 화면에 필요한
 * 자료만 받고, 다른 지역·전체 색인 같은 미리받기는 하지 않는다.
 */
export function prefersDataSaving(): boolean {
  if (typeof navigator === "undefined") return false;
  const connection = (navigator as Navigator & { connection?: NetworkInformationLike }).connection;
  if (connection?.saveData === true) return true;
  try {
    return typeof window !== "undefined" && window.matchMedia?.("(prefers-reduced-data: reduce)").matches === true;
  } catch {
    return false;
  }
}
