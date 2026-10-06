// 공개 MCP: 외부 데이터 연계(지역 돌봄 수요 통계·장기요양기관·정부24 혜택정보·법령 근거·연계 현황) 조회 도구 5개.
// 웹 화면과 같은 lib/integrations/public.ts 함수를 써서 건수·기준일·출처·상태가 같다. 확정되지 않은 사업–기관·사업–법령·사업–정부24 관계는
// 확정 관계로 돌려주지 않고 상태(연결 미확인)와 대기 건수만 알린다.
import { z } from "zod";

import type { SqlDatabase } from "../sql-database.ts";
import { careDemand, careInstitution, careInstitutions, integrationStatus, programPublicInfo, SERVICE_GROUP_LABELS, STATE_LABELS } from "../integrations/public.ts";
import { decodeCursor, encodeCursor, fingerprint, LIMITS, McpToolError, type McpToolName, pageLimit } from "./contract.ts";

export const INTEGRATION_TOOL_NAMES = ["get_integration_status", "get_care_demand", "find_care_institutions", "get_care_institution", "get_program_public_info"] as const;

type Register = <Shape extends z.ZodRawShape>(name: McpToolName, title: string, description: string, shape: Shape, handler: (args: z.objectOutputType<Shape, z.ZodTypeAny>) => Promise<object>) => void;

export interface IntegrationToolHelpers {
  readonly register: Register;
  readonly db: SqlDatabase;
  readonly wrap: (data: unknown, options?: { readonly warnings?: readonly string[]; readonly nextCursor?: string | null; readonly coverage?: { readonly scope: string; readonly complete: boolean; readonly gaps: readonly string[] } }) => Promise<object>;
  readonly today: () => string;
}

const REGION = /^region:[가-힣]{2,20}(\|[가-힣0-9 ]{1,30})?$/;
const regionInput = z.string().max(80).describe("지역 ID. region:<시·도 정식명칭> 또는 region:<시·도>|<시·군·구>. 예: region:경상남도|창원시");
const dateInput = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional().describe("지역코드 적용 기준일(YYYY-MM-DD). 생략하면 오늘(한국시간).");
const STATE_NOTE = "state: " + Object.entries(STATE_LABELS).map(([key, label]) => key + "=" + label).join(", ");
const GROUPS = Object.keys(SERVICE_GROUP_LABELS) as [string, ...string[]];

function checkRegion(regionId: string): void {
  if (!REGION.test(regionId)) throw new McpToolError("REGION_ID_INVALID", "지역 ID 형식이 올바르지 않습니다. 예: region:서울특별시|중랑구");
}

export function registerIntegrationTools({ register, db, wrap, today }: IntegrationToolHelpers): void {
  register("get_integration_status", "외부 연계 수집 현황", "법정동코드·장기요양기관(검색·상세)·정부24 공공서비스·KOSIS·법령(korean-law-mcp 반입) 연계별 제공기관, 이용조건, 호출한도, 갱신주기, 마지막 성공 수집, 상태(미수집·인증키 필요·원천 장애)를 돌려줍니다.", {}, async () => {
    const rows = await integrationStatus(db);
    return wrap({ datasets: rows, legend: STATE_NOTE }, { coverage: { scope: "integration_status", complete: true, gaps: [] } });
  });

  register("get_care_demand", "지역 돌봄 수요·자원 현황", "지역의 KOSIS 돌봄 수요 통계(확인된 통계표만), 장기요양기관 수(기관기호 기준, 서비스 유형 중복 제외)와 유형별 수, 고령인구 1천 명당 장기요양기관 수(산식·분자·분모 기준시점 포함)를 돌려줍니다. 통계로 본 규모이며 통합돌봄 신청자·대상자 수가 아닙니다.", {
    region_id: regionInput,
    as_of: dateInput,
  }, async (args) => {
    checkRegion(args.region_id);
    const demand = await careDemand(db, args.region_id, args.as_of ?? today());
    return wrap(demand, { warnings: ["통계·기관 수는 지역 규모 비교용입니다. 실제 신청자·확정 대상자 수, 빈자리·이용 가능 여부가 아닙니다."], coverage: { scope: "care_demand", complete: false, gaps: demand.legal_codes ? [] : ["이 지역 ID에 확정 연결된 법정동 코드가 없습니다(연결 미확인)."] } });
  });

  register("find_care_institutions", "지역 장기요양기관 찾기", "지역의 장기요양기관을 기관 단위(기관기호)로 찾습니다. 서비스 묶음(방문요양·주야간보호·입소시설 등)과 기관명으로 거를 수 있습니다. 원천의 '실시간' 표기는 빈자리·즉시 이용 가능 여부가 아닙니다.", {
    region_id: regionInput,
    service_group: z.enum(GROUPS).optional().describe("서비스 묶음: " + Object.entries(SERVICE_GROUP_LABELS).map(([key, label]) => key + "=" + label).join(", ")),
    query: z.string().max(LIMITS.queryMax).optional().describe("기관명 일부"),
    as_of: dateInput,
    cursor: z.string().max(400).optional(),
    limit: z.number().int().min(1).max(LIMITS.listMax).optional(),
  }, async (args) => {
    checkRegion(args.region_id);
    const limit = pageLimit(args.limit);
    const bound = fingerprint(["care", args.region_id, args.service_group ?? "", args.query ?? "", args.as_of ?? ""]);
    const offset = decodeCursor(args.cursor, bound);
    const page = await careInstitutions(db, args.region_id, args.as_of ?? today(), { group: args.service_group, query: args.query, offset, limit });
    const next = page.total !== null && offset + page.items.length < page.total ? encodeCursor(offset + page.items.length, bound) : null;
    return wrap({ total: page.total, state: page.state, state_label: STATE_LABELS[page.state], items: page.items }, { nextCursor: next, coverage: { scope: "ltc_institutions", complete: page.state === "COLLECTED", gaps: page.state === "COLLECTED" ? [] : [STATE_LABELS[page.state]] } });
  });

  register("get_care_institution", "장기요양기관 상세", "장기요양기관 한 곳의 일반현황·서비스 유형(원천 코드표 기준)·협약 의료기관(현행/협약기간 종료/원천 목록에서 빠짐 구분)·원천과 수집일을 돌려줍니다.", {
    institution_id: z.string().regex(/^ltc:\d{11}$/).describe("ltc:<장기요양기관기호 11자리>. find_care_institutions 결과의 institution_id."),
  }, async (args) => {
    const detail = await careInstitution(db, args.institution_id, today());
    if (!detail) throw new McpToolError("NOT_FOUND", "수집된 장기요양기관에서 이 ID를 찾지 못했습니다.");
    return wrap(detail);
  });

  register("get_program_public_info", "사업의 공식 혜택정보·법적 근거", "시행사업(service:)에 관리자가 확인한 정부24 공공서비스 정보(지원대상·신청방법·접수기관·문의처, 원천 서비스ID·수정일시)와 법적 근거(법령ID·버전·조문·공포일·시행일·조회기준일·원문 링크)를 돌려줍니다. 확인 전 후보는 내용을 주지 않고 대기 건수만 알립니다.", {
    implementation_id: z.string().min(9).max(LIMITS.idMax).regex(/^service:/).describe("시행사업 ID(service:로 시작). find_programs·search 결과의 implementation_id."),
  }, async (args) => {
    const info = await programPublicInfo(db, args.implementation_id);
    return wrap(info, { warnings: ["법령 인용 확인은 조문 존재 확인이며 법률 해석의 정확성을 보장하지 않습니다."] });
  });
}
