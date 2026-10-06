// node --import 로 korean-law-mcp 서버 프로세스보다 먼저 불러온다. 전역 fetch를 감싸 법제처 차단 페이지를 우회하지 않고 403으로 끝낸다.
// 차단이 일어나면 표준 오류 출력에 한 줄(주소·인증값 없음)을 남겨 수집기가 BLOCKED로 기록하게 한다.
import { ANTIBOT_BLOCK_CODE, guardFetch } from "./antibot-guard.mjs";

globalThis.fetch = guardFetch(globalThis.fetch.bind(globalThis), () => {
  process.stderr.write(ANTIBOT_BLOCK_CODE + "\n");
});
