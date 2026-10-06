import { getD1 } from "../d1";
import { advanceRobotsAudit, autoApproveRobotsAllowed } from "./auto-approve";
import { readPressApiKey } from "./api-keys";
import { collectPressSource, type CollectDeps, type PressFetcher } from "./collect";
import { advanceAutoClassification } from "./auto-classify";
import { assignRelatedGroups } from "./group";
import { crawlerEnabled } from "./operations";
import { listDueSources } from "./store";

// 이 호스팅에서는 예약 작업이 돌지 않으므로, 방문 요청 뒤 남는 시간에 수집할 Source가 있으면 한 곳만 수집한다.
// 서버 인스턴스마다 이 간격으로만 DB를 확인한다.

const CHECK_INTERVAL_MS = 60_000;
// 응답 뒤 백그라운드 작업(waitUntil)은 약 30초 안에 끝나야 한다. 3번 시도(7초씩)와 대기(1초+3초)가 그 안에 들어가게 한다.
// 이보다 길면 수집이 중간에 잘려 실패 기록도 남지 않는다.
const FETCH_TIMEOUT_MS = 7_000;
let lastCheckAt = 0;

function timedFetcher(timeoutMs: number): PressFetcher {
  return async (url, headers) => {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      return await fetch(url, { headers, redirect: "manual", signal: controller.signal });
    } finally {
      clearTimeout(timer);
    }
  };
}

const workerFetcher = timedFetcher(FETCH_TIMEOUT_MS);
// robots.txt 확인은 짧게 끊는다(수집 뒤 남은 시간에도 돌 수 있게).
const robotsFetcher = timedFetcher(3_000);

export function workerCollectDeps(): CollectDeps {
  return {
    fetcher: workerFetcher,
    now: () => Math.floor(Date.now() / 1000),
    sleep: (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds)),
    newId: () => crypto.randomUUID(),
    readApiKey: readPressApiKey,
  };
}

export async function advancePressInBackground(): Promise<void> {
  const now = Date.now();
  if (now - lastCheckAt < CHECK_INTERVAL_MS) return;
  lastCheckAt = now;
  const db = getD1();
  // 관리자 전체 수집 스위치가 꺼져 있으면 기관 서버에 어떤 요청(수집·robots.txt 확인)도 보내지 않는다.
  if (!(await crawlerEnabled(db))) {
    await assignRelatedGroups(db);
    await advanceAutoClassification(db, Math.floor(Date.now() / 1000));
    return;
  }
  const [source] = await listDueSources(db, Math.floor(now / 1000), 1);
  if (source) await collectPressSource(db, { source, trigger: "scheduled" }, workerCollectDeps());
  // 승인 대기 Source 중 robots.txt가 허용하는 곳을 자동 승인한다(운영자 지시 2026-10-04).
  // 정기 시각 뒤 수집 대기열이 길어도 멈추지 않게 매 차례 돈다. 응답 뒤 작업 시간(약 30초) 안에 끝나도록 수집한 차례에는 1곳, 아니면 3곳까지만 본다.
  await autoApproveRobotsAllowed(db, robotsFetcher, Math.floor(Date.now() / 1000), source ? 1 : 3);
  // 전국 기관 robots.txt 7일 주기 점검(지침 31항). 수집하지 않은 차례에만 한 곳씩 본다.
  if (!source) await advanceRobotsAudit(db, robotsFetcher, Math.floor(Date.now() / 1000), 1);
  // 새로 들어온 게시물의 제목 열쇠를 채우고 관련 묶음을 잇는다(한 번에 200건).
  await assignRelatedGroups(db);
  // 사전이 바뀐 항목 재분류와 검토 대기의 학습 판정(한 번에 200건, DB 안에서만 처리).
  await advanceAutoClassification(db, Math.floor(Date.now() / 1000));
}
