import type { BokjiroRaw, BokjiroStepCode, CatalogRow, WelfareOrg } from "./catalog-types";
import type { WelfareInstitution } from "./model";
import type { Authority, LegalBasis, LegalSource, NodeStatus, NodeType, ProcessEdge, ProcessModel, ProcessNode } from "./types";

/** 복지로 복지서비스 상세를 수집한 기준일. */
export const BOKJIRO_AS_OF = "2026-09-24";

export const STEP_TITLES: Record<BokjiroStepCode, string> = {
  "001": "신청접수",
  "002": "조사",
  "003": "결정",
  "004": "이의신청",
  "005": "급여지급",
  "006": "사후관리",
};

/** 화면에 그리는 순서. 이의신청은 결정에서 갈라지는 되돌림 흐름이라 맨 뒤에 둔다. */
const STEP_ORDER: BokjiroStepCode[] = ["001", "002", "003", "005", "006", "004"];

const MONEY_FLOW: Record<string, string> = {
  현금지급: "대상자에게 현금으로 지급합니다.",
  지역화폐: "지역화폐(지역사랑상품권·카드)로 지급합니다.",
  전자바우처: "바우처를 만들어 이용자가 제공기관에서 결제하고, 제공기관은 결제 내역으로 비용을 정산받습니다.",
  실물바우처: "이용권을 발급해 지정된 곳에서 쓰도록 합니다.",
  현물지급: "물품·현물로 제공합니다.",
  감면: "요금·세액 등을 감면합니다.",
  "현금대여(융자)": "자금을 빌려주고 정해진 조건으로 돌려받습니다.",
  현물대여: "물품을 빌려주고 사용 후 돌려받습니다.",
  "프로그램/서비스": "서비스·프로그램 형태로 제공합니다.",
  시설입소: "시설 입소·이용을 지원합니다.",
  자원봉사: "자원봉사 활동으로 제공합니다.",
  기타: "복지로에 등록된 제공유형은 '기타'입니다.",
};

export function bokjiroUrl(id: string, org: WelfareOrg): string {
  return (
    "https://www.bokjiro.go.kr/ssis-tbu/twataa/wlfareInfo/moveTWAT52011M.do?wlfareInfoId=" +
    id +
    "&wlfareInfoReldBztpCd=" +
    (org === "중앙부처" ? "01" : "02")
  );
}

export function clip(value: string | undefined, max: number): string {
  const text = (value ?? "").replace(/\s+/g, " ").trim();
  return text.length > max ? text.slice(0, max - 1).trimEnd() + "…" : text;
}

function firstSentence(value: string | undefined, max: number): string {
  const text = (value ?? "").replace(/^[•\-\s]+/, "").split(/\n/)[0] ?? "";
  return clip(text, max);
}

function deliverLabel(provision: string[]): { stage: string; node: string } {
  const first = provision[0] ?? "기타";
  if (/바우처/.test(first)) return { stage: "바우처 지원", node: "바우처 지원" };
  if (first === "현물지급") return { stage: "현물 제공", node: "현물 제공" };
  if (first === "감면") return { stage: "감면 적용", node: "감면 적용" };
  if (/대여|융자/.test(first)) return { stage: "대여 실행", node: "자금·물품 대여" };
  if (/서비스|시설|자원봉사/.test(first)) return { stage: "서비스 제공", node: "서비스 제공" };
  if (first === "지역화폐") return { stage: "급여 지급", node: "지역화폐 지급" };
  if (first === "현금지급") return { stage: "급여 지급", node: "현금 지급" };
  return { stage: "지원 제공", node: "지원 제공" };
}

function laneName(value: string): string {
  const text = value
    .replace(/\s+/g, " ")
    .replace(/^대상자\s*/, "")
    .replace(/주민등록\s*상\s*/g, "")
    .replace(/읍면동행정복지센터/g, "읍면동 행정복지센터")
    .trim();
  return clip(text, 26);
}

/** 담당 부서를 레인 이름으로 줄인다. 예: 경상남도 밀양시 문화복지국 주민복지과 → 밀양시 주민복지과 */
export function deptLabel(raw: Pick<BokjiroRaw, "org" | "inst" | "dept" | "sido" | "sigungu">): string {
  if (raw.org === "중앙부처") return raw.inst?.trim() || clip(raw.dept, 20) || "소관 부처";
  const tokens = (raw.dept ?? "").trim().split(/\s+/).filter(Boolean);
  const last = tokens.at(-1) ?? "";
  const place = raw.sigungu || raw.sido || "";
  if (!last) return place ? place + " 담당부서" : "담당부서";
  if (!place || tokens.length === 1 && last.startsWith(place)) return clip(last, 26);
  return clip(place + " " + last, 26);
}

function fullDept(raw: BokjiroRaw): string {
  if (raw.org === "중앙부처") return [raw.inst, raw.dept].filter(Boolean).join(" ").trim() || "소관 부처";
  return raw.dept?.trim() || deptLabel(raw);
}

function buildAutoProcess(raw: BokjiroRaw): { process: ProcessModel; generic: boolean; orgs: Map<BokjiroStepCode, string[]> } {
  const orgs = new Map<BokjiroStepCode, string[]>();
  for (const step of raw.steps) {
    const org = laneName(step.org);
    if (!org) continue;
    const list = orgs.get(step.code) ?? [];
    if (!list.includes(org)) list.push(org);
    orgs.set(step.code, list);
  }
  const generic = orgs.size === 0;
  if (generic) {
    const lane = deptLabel(raw);
    for (const code of ["001", "002", "003", "005", "006"] as BokjiroStepCode[]) orgs.set(code, [lane]);
  }

  const deliver = deliverLabel(raw.provision);
  const stageName: Record<BokjiroStepCode, string> = {
    "001": "신청·접수",
    "002": "조사",
    "003": "결정·통지",
    "005": deliver.stage,
    "006": "사후관리",
    "004": "이의신청",
  };
  const codes = STEP_ORDER.filter((code) => orgs.has(code));
  const stages = ["신청·접수", ...codes.filter((code) => code !== "001").map((code) => stageName[code])];

  const applicants = raw.applicants.length > 0 ? raw.applicants.join("·") : "본인";
  const applyAction =
    "신청방법: " +
    (raw.applyMethods.length > 0 ? raw.applyMethods.join("·") : "복지로 안내 참조") +
    (raw.online ? " (복지로 온라인 신청 가능)" : "") +
    ". " +
    firstSentence(raw.applyText, 110);

  const nodes: ProcessNode[] = [
    {
      id: "P01",
      name: "서비스 신청",
      lane: "신청인",
      stage: "신청·접수",
      type: "task",
      status: "done",
      actor: "신청인(" + applicants + ")",
      action: applyAction.trim(),
      blocker: null,
      confidence: 0.75,
      legal_basis: [],
    },
  ];

  const mainOrder: string[] = [];
  let index = 2;
  let progress = 0;
  for (const code of codes) {
    const list = orgs.get(code) ?? [];
    const id = "P" + String(index++).padStart(2, "0");
    let name = STEP_TITLES[code];
    let type: NodeType = "task";
    let status: NodeStatus = "waiting";
    let action = "";
    switch (code) {
      case "001":
        name = "신청 접수";
        action = "신청을 접수합니다. 접수기관: " + list.join(" · ") + ".";
        break;
      case "002":
        name = "대상 자격 조사";
        action = "선정기준 충족 여부를 조사합니다. " + (raw.selection ? "선정기준: " + firstSentence(raw.selection, 120) : raw.target ? "지원대상: " + firstSentence(raw.target, 120) : "");
        break;
      case "003":
        name = "지원 결정·통지";
        type = "gateway";
        action = "조사 결과로 지원 여부를 결정해 알립니다.";
        break;
      case "005":
        name = deliver.node;
        action = (raw.benefit ? firstSentence(raw.benefit, 130) : "결정된 지원을 제공합니다.") + (raw.cycle.length > 0 ? " (지원주기: " + raw.cycle.join("·") + ")" : "");
        break;
      case "006":
        name = "사후관리";
        status = "loop";
        action =
          raw.changeEvents.length > 0
            ? "변동 신고 대상: " + raw.changeEvents.join("·") + ". 변동이 생기면 지원을 조정합니다."
            : "지원 이후 변동 사항을 관리합니다.";
        break;
      case "004":
        name = "이의신청 처리";
        type = "gateway";
        status = "loop";
        action = "결정에 이의가 있으면 이의신청을 받아 다시 판단합니다.";
        break;
    }
    if (code !== "004" && code !== "006") {
      status = progress === 0 ? "done" : progress === 1 ? "current" : "waiting";
      progress++;
      mainOrder.push(id);
    }
    nodes.push({
      id,
      name,
      lane: list[0],
      stage: stageName[code],
      type,
      status,
      actor: list.join(" · "),
      action: action.trim(),
      input_documents: code === "001" && raw.forms.length > 0 ? raw.forms.slice(0, 4) : undefined,
      blocker: null,
      confidence: generic ? 0.55 : 0.72,
      legal_basis: [],
    });
  }

  const idOf = (code: BokjiroStepCode) => {
    const position = codes.indexOf(code);
    return position < 0 ? null : "P" + String(position + 2).padStart(2, "0");
  };
  const edgeList: [string, string, ProcessEdge["type"], string | null][] = [];
  const chain = ["P01", ...mainOrder];
  for (let i = 0; i < chain.length - 1; i++) edgeList.push([chain[i], chain[i + 1], "sequence", null]);
  const aftercare = idOf("006");
  if (aftercare) {
    edgeList.push([chain.at(-1)!, aftercare, "sequence", null]);
    const back = idOf("002") ?? idOf("003");
    if (back) edgeList.push([aftercare, back, "loop", "변동 시 재조사"]);
  }
  const appeal = idOf("004");
  if (appeal) {
    const decision = idOf("003") ?? chain.at(-1)!;
    edgeList.push([decision, appeal, "message", "결정 통지"]);
    edgeList.push([appeal, decision, "loop", "이의 인정 시 재결정"]);
  }
  const edges: ProcessEdge[] = edgeList.map(([source, target, type, label], position) => ({
    id: "E" + String(position + 1).padStart(2, "0"),
    source,
    target,
    type,
    label,
  }));

  const lanes: string[] = [];
  for (const node of nodes) if (!lanes.includes(node.lane)) lanes.push(node.lane);
  return { process: { institution_name: raw.name, lanes, stages, nodes, edges }, generic, orgs };
}

function fieldChecks(raw: BokjiroRaw, generic: boolean): string[] {
  const checks = ["복지로 수정일(" + (raw.updatedAt ?? "미표기") + ") 이후 지침·조례 개정 여부"];
  if (!raw.selection) checks.push("선정기준(소득·재산·거주 요건 등) 세부 내용");
  if (!/\d/.test(raw.benefit ?? "")) checks.push("지원 금액·횟수·기간");
  if (raw.laws.length === 0) checks.push("근거 법령·조례");
  else if (raw.laws.every((law) => !law.article)) checks.push("근거 조문 번호");
  if (generic) checks.push("처리절차(접수·결정 기관과 처리 기한): 복지로에 절차가 등록되지 않아 일반 흐름으로 그렸습니다");
  if (raw.endDate) checks.push("사업 종료일(" + raw.endDate + ") 이후 계속 여부");
  if (raw.contacts.length === 0) checks.push("담당 부서 연락처");
  return checks;
}

/** 복지로 원자료를 제도 페이지 모델로 펼친다. */
export function expandBokjiro(raw: BokjiroRaw): WelfareInstitution {
  const { process, generic, orgs } = buildAutoProcess(raw);
  const legalBasis: LegalBasis[] = raw.laws.map((law) => ({ law: law.name, articles: law.article ?? "", kind: law.kind, url: law.url }));

  const authorityRoles = new Map<string, string[]>();
  const addAuthority = (name: string, role: string) => {
    if (!name) return;
    const roles = authorityRoles.get(name) ?? [];
    if (!roles.includes(role)) roles.push(role);
    authorityRoles.set(name, roles);
  };
  addAuthority(fullDept(raw), "사업 담당");
  for (const code of STEP_ORDER) for (const org of orgs.get(code) ?? []) addAuthority(org, STEP_TITLES[code]);
  const authorities: Authority[] = [...authorityRoles].map(([name, roles]) => ({ name, role: roles.join("·") }));

  const orgNames = [...new Set([...orgs.values()].flat())];
  const applicants = raw.applicants.length > 0 ? raw.applicants.join("·") : "본인";
  const contact = raw.contacts.map((item) => (item.name ? item.name + " " : "") + item.value).join(" · ");
  const sources = ["복지로 복지서비스 정보 " + raw.id + (raw.updatedAt ? " (복지로 수정일 " + raw.updatedAt + ")" : "")];
  for (const ref of raw.talkRefs) {
    const label = "[" + ref.key + "] " + ref.title;
    if (!sources.includes(label)) sources.push(label);
  }
  const legalSources: LegalSource[] = legalBasis
    .filter((basis): basis is LegalBasis & { url: string } => Boolean(basis.url))
    .map((basis) => ({ law: basis.law, kind: basis.kind, officialUrl: basis.url }));

  const scope =
    "복지로 복지서비스 상세(" +
    raw.id +
    (raw.updatedAt ? ", 복지로 수정일 " + raw.updatedAt : "") +
    ")의 지원대상·선정기준·지원내용·신청방법·처리절차·근거법령을 옮겨 정리했습니다. " +
    (raw.talkRefs.length > 0
      ? "복지톡 DB 사업안내 원문 " + raw.talkRefs.length + "건을 함께 연결했습니다. "
      : "복지톡 DB에서 이 제도명과 이어지는 원문은 찾지 못했습니다. ") +
    (generic
      ? "복지로에 처리절차가 등록되지 않아 업무구조도는 제공유형에 따른 일반 흐름으로 그렸습니다."
      : "업무구조도는 복지로 처리절차에 등록된 단계별 담당기관을 기준으로 그렸습니다.");

  const provisionText = raw.provision.length > 0 ? raw.provision.join("·") : "기타";
  return {
    slug: raw.id,
    name: raw.name,
    oneLiner: raw.summary,
    type: provisionText,
    priority: raw.priority,
    category: raw.topics[0] ?? "생활지원",
    whyFirst: "",
    asOfDate: BOKJIRO_AS_OF,
    status: "full",
    canvas: {
      purpose: raw.summary,
      stakeholders:
        "신청인(" + applicants + ")" + (raw.ages ? " · 대상 연령 " + raw.ages : "") + (orgNames.length > 0 ? " · " + orgNames.join(" · ") : ""),
      legalBasis,
      authorities,
      procedure: [],
      moneyFlow:
        "제공유형 " + provisionText + ". " + (MONEY_FLOW[raw.provision[0] ?? "기타"] ?? MONEY_FLOW["기타"]) + (raw.cycle.length > 0 ? " (지원주기: " + raw.cycle.join("·") + ")" : ""),
      docsFlow:
        raw.forms.length > 0
          ? "복지로 등록 서식·자료: " + raw.forms.join(", ")
          : "복지로에 등록된 서식·자료가 없습니다. 신청방법의 구비서류 안내를 따릅니다.",
      bottlenecks: [],
      reformPoints: [],
    },
    related: [],
    fieldVerification: fieldChecks(raw, generic),
    verification: {
      status: "source-linked",
      verifiedAt: raw.updatedAt ?? BOKJIRO_AS_OF,
      method: "복지로 복지서비스 상세 원문",
      scope,
      sources: legalSources,
    },
    process,
    topics: raw.topics,
    lifecycle: raw.lifecycle,
    household: raw.household,
    support: {
      target: raw.target ?? "",
      selection: raw.selection,
      benefit: raw.benefit ?? "",
      apply: raw.applyText ?? "신청방법: " + raw.applyMethods.join("·"),
      contact: contact || fullDept(raw),
    },
    sources,
    analysis: "auto",
    org: raw.org,
    sido: raw.sido ?? "",
    sigungu: raw.sigungu ?? "",
    topicSource: raw.topicSource,
    bokjiro: raw,
    bokjiroIds: [raw.id],
    talkRefs: raw.talkRefs,
    relatedServices: [],
  };
}

/** 편집 제도의 유형을 복지로 제공유형으로 옮긴다. */
const CURATED_PROVISION: Record<string, string> = {
  현금급여형: "현금지급",
  의료비지원형: "현금지급",
  긴급지원형: "현금지급",
  보훈지원형: "현금지급",
  자산형성형: "현금지급",
  바우처형: "전자바우처",
  "감면·할인형": "감면",
  현물지원형: "현물지급",
  "대여·융자형": "현금대여(융자)",
  시설이용형: "시설입소",
};

export function provisionOf(institution: WelfareInstitution): string[] {
  if (institution.bokjiro && institution.bokjiro.provision.length > 0) return institution.bokjiro.provision;
  return [CURATED_PROVISION[institution.type] ?? "프로그램/서비스"];
}

/** 제도 한 건의 복지톡 DB 원문 연결 수(매뉴얼 기준). */
export function talkSourceCount(institution: WelfareInstitution): number {
  const keys = new Set(institution.talkRefs.map((ref) => ref.key));
  for (const source of institution.sources) {
    const match = source.match(/^\[(\d{2})\]/);
    if (match) keys.add(match[1]);
  }
  return keys.size;
}

export function toCatalogRow(institution: WelfareInstitution): CatalogRow {
  const process = institution.process;
  const dept = institution.bokjiro
    ? institution.org === "중앙부처"
      ? institution.bokjiro.inst ?? ""
      : deptLabel(institution.bokjiro)
    : institution.canvas.authorities[0]?.name ?? "";
  return {
    s: institution.slug,
    n: institution.name,
    o: clip(institution.oneLiner, 84),
    no: institution.priority,
    g: institution.org === "중앙부처" ? 0 : 1,
    a: institution.analysis === "curated" ? 1 : 0,
    sd: institution.sido,
    sg: institution.sigungu,
    c: institution.category ?? "",
    t: institution.topics,
    l: institution.lifecycle,
    h: institution.household,
    y: institution.type,
    pv: provisionOf(institution),
    cy: institution.bokjiro?.cycle ?? [],
    d: dept,
    p: process?.nodes.length ?? 0,
    ln: process?.lanes.length ?? 0,
    gw: process?.nodes.filter((node) => node.type === "gateway").length ?? 0,
    lw: institution.canvas.legalBasis.length,
    k: talkSourceCount(institution),
    b: institution.canvas.bottlenecks.length,
    on: institution.bokjiro?.online ? 1 : 0,
    laws: institution.canvas.legalBasis.slice(0, 2).map((basis) => clip(basis.law, 32)),
  };
}
