import type {
  Institution,
  LegalBasis,
  LegalBasisKind,
  NodeStatus,
  NodeType,
  ProcessEdge,
  ProcessModel,
  ProcessNode,
} from "./types";
import type { BokjiroRaw, RelatedService, TalkRef, TopicSource, WelfareOrg } from "./catalog-types";
import { lawUrl } from "./law-url.ts";

export { lawUrl };

/** 복지로 서비스 목록의 분류 체계 (관심주제 · 생애주기 · 가구상황). */
export const TOPIC_ORDER = [
  "생활지원", "신체건강", "정신건강", "주거", "일자리", "문화·여가", "안전·위기", "임신·출산",
  "보육", "교육", "입양·위탁", "보호·돌봄", "서민금융", "법률", "에너지",
] as const;
export const LIFECYCLE_ORDER = ["임신·출산", "영유아", "아동", "청소년", "청년", "중장년", "노년"] as const;
export const HOUSEHOLD_ORDER = ["저소득", "장애인", "한부모·조손", "다자녀", "다문화·탈북민", "보훈대상자"] as const;

export const AS_OF_DATE = "2026-09-23";

export interface ProgramMeta {
  no: number;
  slug: string;
  name: string;
  topic: string;
  topics: string[];
  lifecycle: string[];
  household: string[];
}

interface StepOverride {
  r?: string;
  n?: string;
  a?: string;
  in?: string[];
  out?: string[];
  d?: string;
  law?: string | string[];
  b?: string;
  c?: number;
  actor?: string;
}

export interface WelfareRecord {
  s: string;
  type: string;
  one: string;
  purpose: string;
  who: string;
  target: string;
  benefit: string;
  apply: string;
  contact: string;
  laws: [string, string, string][];
  auth: [string, string][];
  flow: FlowKey;
  lanes?: Record<string, string>;
  steps?: Record<string, StepOverride>;
  money: string;
  docs: string;
  bn: string[];
  rf: string[];
  rel: string[];
  chk: string[];
  src: string[];
}

export type FlowKey =
  | "cash" | "voucher" | "service" | "case" | "emergency" | "medical"
  | "registration" | "savings" | "jobs" | "facility" | "protection" | "insurance";

type TemplateNode = [id: string, role: string, stage: number, name: string, type: NodeType, status: NodeStatus, action: string, deadline?: string, blocker?: string];

interface FlowTemplate {
  stages: string[];
  roles: Record<string, string>;
  nodes: TemplateNode[];
  edges: [string, string, ("sequence" | "message" | "loop")?, string?][];
}

const T: Record<FlowKey, FlowTemplate> = {
  cash: {
    stages: ["기준 고시", "신청·접수", "조사", "결정·통지", "급여 지급", "사후관리", "이의신청"],
    roles: { ministry: "보건복지부", applicant: "신청인", front: "읍면동 행정복지센터", system: "사회보장정보원(행복이음)", office: "시군구", appeal: "시·도(이의신청 심사)" },
    nodes: [
      ["P01", "ministry", 0, "선정기준·급여액 고시", "notice", "done", "연도별 선정기준과 지급 기준을 정해 알린다."],
      ["P02", "applicant", 1, "급여 신청", "task", "done", "본인·친족 등이 주소지 읍면동이나 복지로에서 신청한다."],
      ["P03", "front", 1, "신청 접수·구비서류 확인", "task", "done", "신청서와 금융정보 제공 동의서 등을 접수하고 상담한다."],
      ["P04", "system", 2, "공적자료·금융정보 조회", "system", "current", "소득·재산·인적 자료를 연계 조회한다."],
      ["P05", "office", 2, "소득·재산 등 자격 조사", "task", "risk", "소득인정액과 가구 특성을 확인한다.", undefined, "자료 회신·서류 보완 대기"],
      ["P06", "office", 3, "지급 여부·급여액 결정", "gateway", "waiting", "선정기준 충족 여부와 급여액을 결정한다."],
      ["P07", "office", 3, "결정 통지", "notice", "waiting", "결정 내용과 이의신청 방법을 서면으로 알린다.", "신청일부터 30일 이내(특별한 사유 시 60일)"],
      ["P08", "office", 4, "급여 지급", "task", "waiting", "정해진 날짜에 수급자 계좌로 지급한다."],
      ["P09", "office", 5, "확인조사·변동 처리", "task", "loop", "정기·수시 확인조사로 급여를 변경·중지한다."],
      ["P10", "applicant", 6, "이의신청", "task", "loop", "결정에 불복하면 통지를 받은 날부터 90일 이내 신청한다.", "통지일부터 90일 이내"],
      ["P11", "appeal", 6, "이의신청 심사·처분", "gateway", "waiting", "이의신청을 심사해 처분을 유지·변경한다.", "접수 후 30일 이내"],
    ],
    edges: [["P01", "P03", "message"], ["P02", "P03"], ["P03", "P04"], ["P04", "P05"], ["P05", "P06"], ["P06", "P07"], ["P07", "P08"], ["P08", "P09"], ["P09", "P05", "loop", "소득·재산 변동 시 재조사"], ["P07", "P10", "message"], ["P10", "P11"], ["P11", "P06", "loop", "처분 변경 시 재결정"]],
  },
  voucher: {
    stages: ["사업 공고", "신청·접수", "자격 확인", "대상 결정", "바우처 생성", "서비스 이용", "정산·점검"],
    roles: { ministry: "보건복지부", applicant: "신청인", front: "읍면동 행정복지센터", office: "시군구", system: "사회보장정보원(전자바우처)", provider: "제공기관" },
    nodes: [
      ["P01", "ministry", 0, "사업 지침·지원 단가 확정", "notice", "done", "지원 대상·단가·본인부담 기준을 정해 알린다."],
      ["P02", "applicant", 1, "서비스 신청", "task", "done", "주소지 읍면동이나 온라인으로 신청한다."],
      ["P03", "front", 1, "신청 접수", "task", "done", "신청서와 증빙서류를 받아 시스템에 등록한다."],
      ["P04", "office", 2, "소득·욕구 기준 확인", "task", "current", "소득 기준과 서비스 필요성을 확인한다.", undefined, "소득 자료 확인 지연"],
      ["P05", "office", 3, "대상자 결정·통지", "gateway", "waiting", "선정 결과와 본인부담금을 알린다."],
      ["P06", "system", 4, "바우처 생성·카드 연계", "system", "waiting", "지원 금액만큼 바우처를 생성한다."],
      ["P07", "applicant", 5, "제공기관 선택·계약", "task", "waiting", "이용할 제공기관을 골라 계약한다."],
      ["P08", "provider", 5, "서비스 제공·결제", "task", "waiting", "서비스 제공 후 바우처로 결제한다.", "월 단위 이용"],
      ["P09", "system", 6, "제공기관 비용 정산", "system", "waiting", "결제 내역을 바탕으로 제공기관에 비용을 지급한다."],
      ["P10", "office", 6, "제공기관 점검·부정사용 조치", "task", "risk", "제공 인력·결제 적정성을 점검하고 부당청구를 환수한다.", undefined, "허위·부당 결제 적발"],
    ],
    edges: [["P01", "P03", "message"], ["P02", "P03"], ["P03", "P04"], ["P04", "P05"], ["P05", "P06"], ["P06", "P07"], ["P07", "P08"], ["P08", "P09"], ["P09", "P10"], ["P10", "P08", "loop", "부적정 결제 시 환수·재제공"]],
  },
  service: {
    stages: ["신청·발굴", "욕구 사정", "대상 결정", "서비스 계획", "서비스 제공", "모니터링", "종결·재사정"],
    roles: { applicant: "이용자·가족", front: "읍면동 행정복지센터", office: "시군구", provider: "수행기관", ministry: "보건복지부" },
    nodes: [
      ["P01", "applicant", 0, "서비스 신청", "task", "done", "본인·가족·이웃이 신청하거나 담당 공무원이 직권 신청한다."],
      ["P02", "front", 0, "신청 접수·초기상담", "task", "done", "필요한 돌봄을 확인하고 신청서를 접수한다."],
      ["P03", "provider", 1, "방문 욕구 사정", "task", "current", "생활 상태와 필요한 서비스를 조사한다."],
      ["P04", "office", 2, "서비스 대상 결정", "gateway", "waiting", "기준 충족 여부와 제공량을 결정한다."],
      ["P05", "provider", 3, "개인별 서비스 계획 수립", "task", "waiting", "제공 내용·횟수·담당 인력을 정한다."],
      ["P06", "provider", 4, "서비스 제공", "task", "waiting", "계획에 따라 방문·연계 서비스를 제공한다."],
      ["P07", "provider", 5, "정기 모니터링", "task", "risk", "서비스 만족도와 상태 변화를 확인한다.", undefined, "인력 부족으로 제공 공백"],
      ["P08", "office", 6, "재사정·변경", "task", "loop", "상태가 바뀌면 제공량을 조정한다."],
      ["P09", "office", 6, "종결 처리", "task", "waiting", "목표 달성·전출·사망 등으로 종결한다."],
    ],
    edges: [["P01", "P02"], ["P02", "P03"], ["P03", "P04"], ["P04", "P05"], ["P05", "P06"], ["P06", "P07"], ["P07", "P08"], ["P08", "P04", "loop", "상태 변화 시 재결정"], ["P07", "P09"]],
  },
  case: {
    stages: ["발굴·의뢰", "초기상담", "욕구조사", "사례회의", "서비스 제공", "점검", "종결"],
    roles: { reporter: "주민·기관(발굴·신고)", system: "사회보장정보원(위기정보)", front: "읍면동 맞춤형복지팀", office: "시군구 희망복지지원단", partner: "공공·민간 서비스기관" },
    nodes: [
      ["P01", "reporter", 0, "위기가구 발굴·의뢰", "task", "done", "이웃·명예사회복지공무원·기관이 위기가구를 알린다."],
      ["P02", "system", 0, "위기정보 입수·대상 추출", "system", "done", "단전·단수·체납 등 위기정보로 조사 대상을 추린다."],
      ["P03", "front", 1, "초기상담·가정방문", "task", "current", "방문해 위기 상황과 욕구를 확인한다."],
      ["P04", "office", 2, "욕구·위기도 사정", "task", "waiting", "가구의 복합 욕구와 위험도를 평가한다."],
      ["P05", "office", 3, "통합사례회의", "gateway", "waiting", "사례관리 여부와 목표·역할을 정한다."],
      ["P06", "partner", 4, "공공·민간 자원 연계", "task", "waiting", "급여·서비스·후원을 연결한다."],
      ["P07", "office", 5, "서비스 제공 점검", "task", "risk", "계획 이행과 상태 변화를 점검한다.", undefined, "연계 자원 부족"],
      ["P08", "office", 5, "재사정", "task", "loop", "목표 미달 시 계획을 다시 세운다."],
      ["P09", "office", 6, "사례 종결·사후관리", "task", "waiting", "목표 달성 후 종결하고 사후 확인한다."],
    ],
    edges: [["P01", "P03"], ["P02", "P03", "message"], ["P03", "P04"], ["P04", "P05"], ["P05", "P06"], ["P06", "P07"], ["P07", "P08"], ["P08", "P04", "loop", "목표 미달 시 재사정"], ["P07", "P09"]],
  },
  emergency: {
    stages: ["발굴·신청", "현장 확인", "지원 결정", "지원 집행", "사후 조사", "적정성 심사"],
    roles: { applicant: "위기가구·신고자", front: "읍면동 행정복지센터", office: "시군구", system: "사회보장정보원", committee: "긴급지원심의위원회" },
    nodes: [
      ["P01", "applicant", 0, "긴급지원 요청·신고", "task", "done", "본인·이웃·기관이 129나 읍면동에 요청한다."],
      ["P02", "front", 0, "상담·위기사유 확인", "task", "done", "위기 사유와 필요한 지원 종류를 확인한다."],
      ["P03", "office", 1, "현장 확인", "task", "current", "담당 공무원이 현장을 방문해 긴급성을 확인한다.", "지체 없이"],
      ["P04", "office", 2, "선지원 결정", "gateway", "waiting", "긴급성이 확인되면 먼저 지원을 결정한다.", "현장 확인 후 즉시(선지원)"],
      ["P05", "office", 3, "지원 집행", "task", "waiting", "생계비·의료비·주거비 등을 지원한다."],
      ["P06", "system", 4, "소득·재산 사후조사", "system", "waiting", "지원 후 소득·재산 기준 충족 여부를 조사한다."],
      ["P07", "committee", 5, "적정성 심사", "gateway", "risk", "지원의 적정성과 연장 여부를 심사한다.", undefined, "기준 초과 시 환수 판단"],
      ["P08", "office", 5, "지원 연장·타 제도 연계", "task", "waiting", "위기가 계속되면 연장하거나 기초생활보장 등으로 연계한다."],
      ["P09", "office", 5, "부적정 지원 환수", "task", "loop", "거짓·부정 지원은 비용을 반환하게 한다."],
    ],
    edges: [["P01", "P02"], ["P02", "P03"], ["P03", "P04"], ["P04", "P05"], ["P05", "P06"], ["P06", "P07"], ["P07", "P08"], ["P07", "P09", "loop", "부적정 판정 시 환수"]],
  },
  medical: {
    stages: ["진료·신청", "대상 확인", "지원 결정", "비용 청구", "심사·지급", "사후관리"],
    roles: { patient: "환자·보호자", hospital: "의료기관", office: "보건소·시군구", payer: "국민건강보험공단", ministry: "보건복지부" },
    nodes: [
      ["P01", "patient", 0, "진료·지원 신청", "task", "done", "진료를 받고 지원을 신청한다."],
      ["P02", "hospital", 0, "진단서·진료비 서류 발급", "task", "done", "진단·진료 내역을 증빙한다."],
      ["P03", "office", 1, "대상 확인(소득·질환)", "task", "current", "소득 기준과 지원 질환 여부를 확인한다."],
      ["P04", "office", 2, "지원 결정·통지", "gateway", "waiting", "지원 여부와 금액을 결정한다."],
      ["P05", "hospital", 3, "비용 청구", "task", "waiting", "본인부담금 등 지원 대상 비용을 청구한다."],
      ["P06", "payer", 4, "청구 심사", "system", "risk", "급여·비급여 항목과 중복 지원을 확인한다.", undefined, "제출 서류 누락"],
      ["P07", "office", 4, "지원금 지급", "task", "waiting", "환자 또는 의료기관에 지급한다."],
      ["P08", "office", 5, "사후관리·환수", "task", "loop", "부정 수급이나 중복 지원을 환수한다."],
    ],
    edges: [["P01", "P02"], ["P02", "P03"], ["P03", "P04"], ["P04", "P05"], ["P05", "P06"], ["P06", "P07"], ["P07", "P08"], ["P08", "P06", "loop", "중복 확인 시 재심사"]],
  },
  registration: {
    stages: ["신청", "진단", "심사", "결정", "등록·연계", "이의신청"],
    roles: { applicant: "신청인", front: "읍면동 행정복지센터", doctor: "의료기관", assessor: "국민연금공단(심사)", office: "시군구" },
    nodes: [
      ["P01", "applicant", 0, "등록 신청", "task", "done", "본인이나 보호자가 읍면동에 신청한다."],
      ["P02", "front", 0, "접수·진단의뢰서 발급", "task", "done", "신청을 접수하고 진단의뢰서를 발급한다."],
      ["P03", "doctor", 1, "진단·진단서 발급", "task", "current", "전문의가 진단하고 진료기록을 첨부한다."],
      ["P04", "assessor", 2, "정도 심사", "gateway", "risk", "진단서와 기록으로 정도를 심사한다.", undefined, "보완 서류 요청"],
      ["P05", "office", 3, "결정·통지", "notice", "waiting", "심사 결과를 신청인에게 알린다."],
      ["P06", "office", 4, "등록·증명 발급", "task", "waiting", "대장에 등록하고 증명서·카드를 발급한다."],
      ["P07", "office", 4, "서비스 연계 안내", "task", "waiting", "받을 수 있는 급여와 서비스를 안내한다."],
      ["P08", "applicant", 5, "이의신청", "task", "loop", "결과에 이의가 있으면 통지일부터 90일 이내 신청한다.", "90일 이내"],
    ],
    edges: [["P01", "P02"], ["P02", "P03"], ["P03", "P04"], ["P04", "P05"], ["P05", "P06"], ["P06", "P07"], ["P05", "P08", "message"], ["P08", "P04", "loop", "재심사"]],
  },
  savings: {
    stages: ["모집 공고", "신청", "자격 조사", "가입 결정", "적립", "중간 점검", "만기 지급"],
    roles: { ministry: "보건복지부", applicant: "가입 희망자", front: "읍면동 행정복지센터", office: "시군구", bank: "협약 은행·자활복지개발원" },
    nodes: [
      ["P01", "ministry", 0, "모집 공고", "notice", "done", "모집 기간과 가입 요건을 알린다."],
      ["P02", "applicant", 1, "가입 신청", "task", "done", "모집 기간에 신청서를 낸다."],
      ["P03", "front", 1, "신청 접수", "task", "done", "신청서와 동의서를 접수한다."],
      ["P04", "office", 2, "소득·근로 요건 조사", "task", "current", "가구 소득과 근로활동을 확인한다."],
      ["P05", "office", 3, "가입 결정·통장 개설", "gateway", "waiting", "대상자를 확정하고 통장을 만든다."],
      ["P06", "applicant", 4, "본인 저축 적립", "task", "waiting", "매월 정해진 금액을 저축한다.", "매월"],
      ["P07", "bank", 4, "정부지원금 매칭 적립", "system", "waiting", "근로·저축 유지 시 지원금을 적립한다."],
      ["P08", "office", 5, "근로·교육 이수 점검", "task", "risk", "근로활동 유지와 교육 이수를 확인한다.", undefined, "근로 중단·저축 미납"],
      ["P09", "office", 6, "만기 지급 결정", "gateway", "waiting", "지급 요건 충족 여부를 판단한다."],
      ["P10", "bank", 6, "적립금 지급", "task", "waiting", "본인 저축과 지원금을 지급한다."],
    ],
    edges: [["P01", "P02", "message"], ["P02", "P03"], ["P03", "P04"], ["P04", "P05"], ["P05", "P06"], ["P06", "P07"], ["P07", "P08"], ["P08", "P06", "loop", "미납 시 적립 중지·재개"], ["P08", "P09"], ["P09", "P10"]],
  },
  jobs: {
    stages: ["사업 계획", "참여 신청", "선발", "배치·교육", "참여·급여", "점검", "종료·연계"],
    roles: { ministry: "소관 부처", applicant: "참여자", office: "시군구", agency: "수행기관", employer: "참여 사업장" },
    nodes: [
      ["P01", "ministry", 0, "사업 계획·예산 배정", "notice", "done", "연간 사업량과 활동비 기준을 정한다."],
      ["P02", "applicant", 1, "참여 신청", "task", "done", "수행기관이나 읍면동에 신청한다."],
      ["P03", "agency", 2, "자격 확인·선발", "gateway", "current", "참여 자격과 선발 기준 점수를 확인한다.", "모집 후 선발"],
      ["P04", "agency", 3, "배치·사전교육", "task", "waiting", "활동처에 배치하고 안전·직무 교육을 한다."],
      ["P05", "employer", 4, "활동 참여", "task", "waiting", "정해진 시간 동안 일하거나 활동한다."],
      ["P06", "agency", 4, "급여·활동비 지급", "task", "waiting", "참여 실적에 따라 급여를 지급한다.", "매월"],
      ["P07", "office", 5, "참여 실태 점검", "task", "risk", "근태·안전과 부정 참여를 점검한다.", undefined, "허위 근무·안전사고"],
      ["P08", "agency", 6, "종료·취업 연계", "task", "waiting", "기간 종료 후 일반 일자리나 다른 서비스로 연계한다."],
    ],
    edges: [["P01", "P02", "message"], ["P02", "P03"], ["P03", "P04"], ["P04", "P05"], ["P05", "P06"], ["P06", "P07"], ["P07", "P05", "loop", "시정 후 재참여"], ["P07", "P08"]],
  },
  facility: {
    stages: ["이용 신청", "대상 확인", "이용 등록", "서비스 운영", "운영비 지원", "지도점검"],
    roles: { user: "이용자·보호자", facility: "운영기관", office: "시군구", ministry: "보건복지부" },
    nodes: [
      ["P01", "user", 0, "이용 신청", "task", "done", "운영기관에 직접 이용을 신청한다."],
      ["P02", "facility", 1, "대상 확인·상담", "task", "done", "이용 자격과 필요를 확인한다."],
      ["P03", "facility", 2, "이용 등록", "gateway", "done", "정원과 우선순위에 따라 등록한다."],
      ["P04", "facility", 3, "프로그램·서비스 제공", "task", "current", "돌봄·상담·프로그램을 운영한다.", "상시"],
      ["P05", "office", 4, "운영비 교부", "task", "waiting", "국비·지방비 운영비를 교부한다.", "분기·월별"],
      ["P06", "facility", 4, "운영비 정산", "task", "waiting", "사용 내역을 보고하고 정산한다."],
      ["P07", "office", 5, "지도점검·평가", "task", "risk", "운영 기준과 회계를 점검한다.", "연 1회 이상", "종사자 부족·운영 기준 미달"],
    ],
    edges: [["P01", "P02"], ["P02", "P03"], ["P03", "P04"], ["P05", "P04", "message"], ["P04", "P06"], ["P06", "P07"], ["P07", "P04", "loop", "시정 요구 후 운영 개선"]],
  },
  protection: {
    stages: ["신고·접수", "현장조사", "보호조치 결정", "보호·지원", "사후관리", "종결"],
    roles: { reporter: "신고자·당사자", agency: "전문기관·경찰", office: "시군구(전담공무원)", committee: "심의위원회", family: "보호 가정·시설" },
    nodes: [
      ["P01", "reporter", 0, "신고·상담 요청", "task", "done", "112·전문기관·시군구에 알린다."],
      ["P02", "agency", 1, "현장 출동·응급조치", "task", "done", "현장을 확인하고 필요하면 분리 등 응급조치를 한다."],
      ["P03", "office", 1, "조사·위험도 판단", "task", "current", "피해 여부와 재발 위험을 판단한다."],
      ["P04", "committee", 2, "보호조치 결정", "gateway", "waiting", "가정 보호·위탁·시설 등 보호 방식을 정한다."],
      ["P05", "family", 3, "보호·양육", "task", "waiting", "결정에 따라 보호하고 양육한다."],
      ["P06", "agency", 3, "치료·상담·가족 지원", "task", "waiting", "회복 서비스와 가족 기능 회복을 지원한다."],
      ["P07", "office", 4, "사후 모니터링", "task", "risk", "보호 상태와 재발 여부를 점검한다.", "정기 방문", "재발·연락 두절"],
      ["P08", "office", 5, "원가정 복귀·종결", "gateway", "waiting", "안전이 확인되면 복귀하거나 자립을 지원한다."],
    ],
    edges: [["P01", "P02"], ["P02", "P03"], ["P03", "P04"], ["P04", "P05"], ["P04", "P06"], ["P05", "P07"], ["P06", "P07"], ["P07", "P04", "loop", "위험 재발 시 재결정"], ["P07", "P08"]],
  },
  insurance: {
    stages: ["신청", "조사", "판정", "결정·통지", "급여 이용", "사후관리", "이의신청"],
    roles: { applicant: "신청인", insurer: "공단", assessor: "판정위원회", provider: "급여 제공기관", ministry: "소관 부처" },
    nodes: [
      ["P01", "applicant", 0, "급여 신청", "task", "done", "공단 지사나 온라인으로 신청한다."],
      ["P02", "insurer", 1, "자격·사실 조사", "task", "current", "신청 요건과 필요 사실을 조사한다."],
      ["P03", "assessor", 2, "수급 판정", "gateway", "waiting", "기준에 따라 수급 여부를 판정한다."],
      ["P04", "insurer", 3, "결정 통지", "notice", "waiting", "결정 내용과 이용 방법을 알린다."],
      ["P05", "provider", 4, "급여 제공·이용", "task", "waiting", "결정된 범위에서 급여를 받는다."],
      ["P06", "insurer", 5, "급여비용 심사·지급", "system", "risk", "청구 내역을 심사해 지급한다.", undefined, "부당청구 적발"],
      ["P07", "insurer", 5, "갱신·재판정", "task", "loop", "유효기간 만료나 상태 변화 시 다시 판정한다."],
      ["P08", "applicant", 6, "이의신청·심사청구", "task", "loop", "처분에 이의가 있으면 이의신청이나 심사청구를 한다."],
    ],
    edges: [["P01", "P02"], ["P02", "P03"], ["P03", "P04"], ["P04", "P05"], ["P05", "P06"], ["P06", "P07"], ["P07", "P03", "loop", "재판정"], ["P04", "P08", "message"], ["P08", "P03", "loop", "처분 변경 시 재판정"]],
  },
};

function splitLaw(value: string): { law: string; article: string } {
  const match = value.match(/^(.*?)\s*(제\s?\d+조.*)$/);
  return match ? { law: match[1].trim(), article: match[2].trim() } : { law: value.trim(), article: "" };
}

function buildProcess(record: WelfareRecord, name: string): ProcessModel {
  const template = T[record.flow];
  const roles = { ...template.roles, ...(record.lanes ?? {}) };
  const laneOrder: string[] = [];
  const nodes: ProcessNode[] = template.nodes.map(([id, role, stageIndex, defaultName, type, status, action, deadline, blocker]) => {
    const step = record.steps?.[id] ?? {};
    const laneKey = step.r ?? role;
    const lane = roles[laneKey] ?? laneKey;
    if (!laneOrder.includes(lane)) laneOrder.push(lane);
    const laws = step.law ? (Array.isArray(step.law) ? step.law : [step.law]) : [];
    return {
      id,
      name: step.n ?? defaultName,
      lane,
      stage: template.stages[stageIndex],
      type,
      status,
      actor: step.actor ?? lane,
      action: step.a ?? action,
      input_documents: step.in,
      output_documents: step.out,
      deadline: step.d === "" ? undefined : step.d ?? deadline,
      blocker: step.b ?? blocker ?? null,
      confidence: step.c ?? (status === "done" ? 0.9 : status === "current" ? 0.8 : 0.72),
      legal_basis: laws.map((value) => splitLaw(value)).filter((item) => item.article),
    };
  });
  const edges: ProcessEdge[] = template.edges.map(([source, target, type = "sequence", label], index) => ({
    id: "E" + String(index + 1).padStart(2, "0"),
    source,
    target,
    type,
    label: label ?? null,
  }));
  return { institution_name: name, lanes: laneOrder, stages: template.stages, nodes, edges };
}

export interface WelfareInstitution extends Institution {
  topics: string[];
  lifecycle: string[];
  household: string[];
  support: { target: string; selection?: string; benefit: string; apply: string; contact: string };
  sources: string[];
  /** curated: 복지톡 DB 원문으로 병목·개선점까지 편집한 제도, auto: 복지로 상세로 구성한 제도 */
  analysis: "curated" | "auto";
  org: WelfareOrg;
  sido: string;
  sigungu: string;
  topicSource: TopicSource;
  bokjiro?: BokjiroRaw;
  bokjiroIds: string[];
  talkRefs: TalkRef[];
  relatedServices: RelatedService[];
}

export interface CuratedExtra {
  org: WelfareOrg;
  sido: string;
  sigungu: string;
  bokjiro?: BokjiroRaw;
  bokjiroIds: string[];
  talkRefs: TalkRef[];
  relatedServices: RelatedService[];
}

export function expandRecord(
  meta: ProgramMeta,
  record: WelfareRecord,
  manualTitles: Record<string, string>,
  extra: CuratedExtra = { org: "중앙부처", sido: "", sigungu: "", bokjiroIds: [], talkRefs: [], relatedServices: [] },
): WelfareInstitution {
  const legalBasis: LegalBasis[] = record.laws.map(([law, articles, kind]) => ({ law, articles, kind: kind as LegalBasisKind }));
  const sources = record.src.map((key) => "[" + key + "] " + (manualTitles[key] ?? "복지톡 DB"));
  if (extra.bokjiro) {
    sources.push("복지로 복지서비스 정보 " + extra.bokjiroIds.join("·") + (extra.bokjiro.updatedAt ? " (복지로 수정일 " + extra.bokjiro.updatedAt + ")" : ""));
  }
  return {
    slug: meta.slug,
    name: meta.name,
    oneLiner: record.one,
    type: record.type,
    priority: meta.no,
    category: meta.topic,
    whyFirst: "",
    asOfDate: AS_OF_DATE,
    status: "full",
    canvas: {
      purpose: record.purpose,
      stakeholders: record.who,
      legalBasis,
      authorities: record.auth.map(([name, role]) => ({ name, role })),
      procedure: [],
      moneyFlow: record.money,
      docsFlow: record.docs,
      bottlenecks: record.bn,
      reformPoints: record.rf,
    },
    related: record.rel,
    fieldVerification: record.chk,
    verification: {
      status: "source-linked",
      verifiedAt: AS_OF_DATE,
      method: "복지톡 DB 원문 대조",
      scope: "복지톡 DB의 2026년 사업안내 원문(" + record.src.map((key) => "[" + key + "]").join(" ") + ")을 기준으로 대상·지원내용·신청방법과 절차를 정리했다. 조문 번호는 원문 표기를 따랐으며 법제처 원문 대조는 하지 않았다.",
      sources: legalBasis
        .map((basis) => ({ basis, url: lawUrl(basis.law) }))
        .filter((item): item is { basis: LegalBasis; url: string } => Boolean(item.url))
        .map(({ basis, url }) => ({ law: basis.law, kind: basis.kind, officialUrl: url })),
    },
    process: buildProcess(record, meta.name),
    topics: meta.topics,
    lifecycle: meta.lifecycle,
    household: meta.household,
    support: { target: record.target, benefit: record.benefit, apply: record.apply, contact: record.contact },
    sources,
    analysis: "curated",
    org: extra.org,
    sido: extra.sido,
    sigungu: extra.sigungu,
    topicSource: "편집",
    bokjiro: extra.bokjiro,
    bokjiroIds: extra.bokjiroIds,
    talkRefs: extra.talkRefs,
    relatedServices: extra.relatedServices,
  };
}
