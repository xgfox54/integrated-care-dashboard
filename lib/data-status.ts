import { readOfficialSyncStatus } from "./official-sync-status.ts";
import { readPressCoverage } from "./press/coverage.ts";
import { currentStatisticsStatus } from "./statistics/store.ts";
import { readManualCorpusState } from "./manuals/store.ts";
import { FISCAL_MCP_PUBLIC, LAW_MCP_PUBLIC, LAW_MCP_WITHHELD_MESSAGE, MCP_SERVER_VERSION, PUBLIC_MCP_TOOL_NAMES } from "./mcp/contract.ts";
import { SIGUNGU_ELDERLY_SNAPSHOT } from "./statistics/sigungu-elderly-verified.ts";
import type { SqlDatabase } from "./sql-database.ts";
import type { DataStatusReport, DomainId, DomainStatus } from "./data-status-paths.ts";

const DAY = 24 * 60 * 60 * 1000;

function failed(domain: DomainId, label: string): DomainStatus {
  return { domain, label, state: "확인 실패", sourceAsOf: null, lastSuccessAt: null, verification: "상태를 확인하지 못했습니다.", available: [], limitations: ["상태 저장소를 읽지 못했습니다. 화면의 마지막 정상 자료는 그대로 유지됩니다."] };
}

async function guard(domain: DomainId, label: string, read: () => Promise<DomainStatus>): Promise<DomainStatus> {
  try { return await read(); } catch { return failed(domain, label); }
}

export async function readDataStatus(db: SqlDatabase, now = new Date()): Promise<DataStatusReport> {
  const nowSeconds = Math.floor(now.getTime() / 1000);
  const domains = await Promise.all([
    guard("official", "통합돌봄 사업·WIKI", async () => {
      const status = await readOfficialSyncStatus();
      const success = status.latestSuccess;
      const attempt = status.latestAttempt;
      const limitations = ["사업구분 '미분류' 사업은 원문 '구분' 칸 대조 결과에 따라 순차 정정하며, 근거 없는 분류는 채우지 않습니다.", "제주 행정시(제주시·서귀포시)는 원자료가 도 단위라 도 공통·적용범위 미확인으로 구분합니다."];
      if (attempt && attempt.status === "failed") limitations.unshift("최근 수집 시도가 실패해 마지막 정상 공개본을 유지하고 있습니다.");
      return {
        domain: "official", label: "통합돌봄 사업·WIKI",
        state: !success ? "미제공" : status.stale ? "갱신 지연" : "정상",
        sourceAsOf: null, lastSuccessAt: success?.completedAt || null,
        verification: "보건복지부 메뉴판 원문 행 원장으로 저장·미해결·제외 행 수를 검산합니다.",
        available: ["검색·필터·상세", "CSV 내려받기", "지역 비교(제주 행정시 포함)"], limitations,
      };
    }),
    guard("welfare100", "복지제도100", async () => ({
      domain: "welfare100", label: "복지제도100", state: "정상", sourceAsOf: "2026-09-24", lastSuccessAt: null,
      verification: "복지로 원자료(2026-09-24 수집)와 관리자 수정 기록으로 빌드한 고정본입니다.",
      available: ["검색·분야 필터·제도 비교", "MCP search_welfare_services"], limitations: ["복지로 원문이 바뀌면 다음 빌드 때 반영됩니다.", "정상은 자료 조회 상태입니다. 상태 조회일·수집일은 지원금액·조건의 최신성 검증일이나 적용연도가 아닙니다."],
    })),
    guard("news", "복지뉴스(공식 보도자료)", async () => {
      const coverage = await readPressCoverage(db, nowSeconds);
      const latest = coverage.items.latest_published_date || null;
      return {
        domain: "news", label: "복지뉴스(공식 보도자료)",
        state: coverage.items.public_total ? (latest && now.getTime() - Date.parse(latest) > 3 * DAY ? "갱신 지연" : "일부 제공") : "미제공",
        sourceAsOf: latest, lastSuccessAt: null,
        verification: "승인된 공공기관 게시판의 제목·기관·날짜·원문 주소만 제공합니다.",
        available: ["제목·발행기관·날짜 검색", "원문 연결"], limitations: ["본문·요약은 저장하지 않습니다.", "일부 기관 게시판은 수집 대기 또는 오류 상태일 수 있습니다."],
      };
    }),
    guard("fiscal", "복지예산", async () => ({
      domain: "fiscal", label: "복지예산", state: FISCAL_MCP_PUBLIC ? "일부 제공" : "미제공", sourceAsOf: null, lastSuccessAt: null,
      verification: "공식 화면 단위 대조를 통과한 금액만 확정값으로 제공하고, 미검증 금액은 0원이 아니라 미확인으로 표시합니다.",
      available: ["예산현액·집행액 조회", "예산서 세부사업"], limitations: ["원·천원·백만원 단위가 자료마다 다르므로 표시 단위를 함께 확인하세요.", "전체 재정 스냅샷 가운데 금액 대조가 끝난 범위만 확정값입니다."],
    })),
    guard("statistics", "복지통계", async () => {
      const status = await currentStatisticsStatus(db);
      const retry = status.automatic_refresh.retry_tables;
      return {
        domain: "statistics", label: "복지통계", state: retry ? "일부 제공" : "정상", sourceAsOf: SIGUNGU_ELDERLY_SNAPSHOT.referenceDate,
        lastSuccessAt: status.automatic_refresh.last_wake_at,
        verification: "통계별 기준연도·단위·결측 기호를 원문 그대로 보존합니다. 관측 시점과 확인일은 다릅니다.",
        available: ["통계 조회·CSV", "시·군·구 65세 이상 인구(" + SIGUNGU_ELDERLY_SNAPSHOT.period + ")"],
        limitations: retry ? [retry + "개 표가 원천 응답 문제로 재시도 중이며 마지막 확인본을 보여 줍니다."] : [],
      };
    }),
    guard("manuals", "복지 매뉴얼", async () => {
      const state = await readManualCorpusState(db);
      return {
        domain: "manuals", label: "복지 매뉴얼", state: state.active ? "일부 제공" : "미제공", sourceAsOf: null,
        lastSuccessAt: state.active?.activated_at ? new Date(state.active.activated_at * (state.active.activated_at > 1e11 ? 1 : 1000)).toISOString() : null,
        verification: "고정 커밋 파싱본(" + (state.active?.document_count ?? 0) + "개 문서·" + (state.active?.section_count ?? 0) + "개 구간)입니다.",
        available: ["본문 검색·구간 이어읽기(MCP)"], limitations: ["공식 원본 URL·PDF 쪽수는 일부만 검증되었습니다.", "파일명의 연도는 적용연도 확정값이 아닙니다."],
      };
    }),
    guard("mcp", "복지정보MCP", async () => ({
      domain: "mcp", label: "복지정보MCP", state: "정상", sourceAsOf: null, lastSuccessAt: null,
      verification: "서버 " + MCP_SERVER_VERSION + " · 공개 조회 도구 " + PUBLIC_MCP_TOOL_NAMES.length + "개(읽기 전용)",
      available: ["ChatGPT /chatgpt/mcp", "Claude·Perplexity·Gemini /claude/mcp"], limitations: LAW_MCP_PUBLIC ? [] : [LAW_MCP_WITHHELD_MESSAGE],
    })),
    guard("law", "법령정보", async () => ({
      domain: "law", label: "법령정보", state: LAW_MCP_PUBLIC ? "정상" : "미제공", sourceAsOf: null, lastSuccessAt: null,
      verification: "법제처 국가법령정보 OPEN API를 요청 시점에 조회합니다(응답 원문은 저장하지 않음).",
      available: LAW_MCP_PUBLIC ? ["MCP 법령 도구"] : [],
      limitations: LAW_MCP_PUBLIC ? [] : ["법령 화면과 MCP 법령 도구는 현재 제공하지 않습니다. 승인된 사업별 법령 근거 연결만 WIKI에 보입니다."],
    })),
  ]);
  return { checkedAt: now.toISOString(), domains };
}


