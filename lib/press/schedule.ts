// 보도자료 정기 수집 시각(한국시간). 이 호스팅은 예약 작업(scheduled)을 실행하지 않아, 등록된 수집 PC의 예약 작업이 15분마다
// 인증된 정기 수집 경로(/api/press/tick)를 불러 이 시각이 지난 Source를 처리한다. 방문 요청 뒤 백그라운드 수집은 보조로 남는다.

export const PRESS_COLLECTION_HOURS_KST: readonly number[] = [9, 12, 15, 18];
export const PRESS_SCHEDULE_LABEL = "매일 09·12·15·18시(한국시간)";

/** 정기 수집 사이 가장 긴 간격(시간). 18시 → 다음 날 09시 = 15시간. */
export const MAX_SCHEDULE_GAP_HOURS = Math.max(
  ...PRESS_COLLECTION_HOURS_KST.map((hour, index) => ((PRESS_COLLECTION_HOURS_KST[(index + 1) % PRESS_COLLECTION_HOURS_KST.length] - hour + 24) % 24) || 24),
);

const KST_OFFSET_SECONDS = 9 * 60 * 60;
const DAY_SECONDS = 24 * 60 * 60;

/** nowSeconds 다음(같은 시각 제외)의 수집 시각. */
export function nextCollectionSlot(nowSeconds: number): number {
  const kstNow = nowSeconds + KST_OFFSET_SECONDS;
  const kstMidnight = kstNow - (((kstNow % DAY_SECONDS) + DAY_SECONDS) % DAY_SECONDS);
  for (let day = 0; day < 2; day += 1) {
    for (const hour of PRESS_COLLECTION_HOURS_KST) {
      const slot = kstMidnight + day * DAY_SECONDS + hour * 3600 - KST_OFFSET_SECONDS;
      if (slot > nowSeconds) return slot;
    }
  }
  throw new Error("수집 시각을 계산하지 못했습니다.");
}

/** nowSeconds 이하에서 가장 최근의 수집 시각(회차 기준). */
export function previousCollectionSlot(nowSeconds: number): number {
  const kstNow = nowSeconds + KST_OFFSET_SECONDS;
  const kstMidnight = kstNow - (((kstNow % DAY_SECONDS) + DAY_SECONDS) % DAY_SECONDS);
  for (let day = 0; day >= -1; day -= 1) {
    for (const hour of [...PRESS_COLLECTION_HOURS_KST].reverse()) {
      const slot = kstMidnight + day * DAY_SECONDS + hour * 3600 - KST_OFFSET_SECONDS;
      if (slot <= nowSeconds) return slot;
    }
  }
  throw new Error("수집 시각을 계산하지 못했습니다.");
}
