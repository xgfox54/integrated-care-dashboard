// 파싱 결과(document.json)에서 '항목: 값' 문단과 '신청자격·제출서류' 같은 절 아래 글머리 문단을 사실 후보로 뽑는다. 로컬 전용.
// 후보는 review_status=candidate로 나오며, 사람이 확인해 approved로 바꾼 것만 build-pack.mjs가 묶는다. 모델·외부 호출 없음.
// 사용: node factory/release/candidates.mjs --parsed <parsed/p_xxx 디렉터리> --out <후보.json>
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const LABELS = {
  지원대상: "target_group", 대상: "target_group", 대상품목: "benefit_item", 지원내용: "benefit_item", 지원방법: "benefit_item",
  지원금액: "benefit_amount", 지원단가: "benefit_amount", 지원기간: "operating_period", 사업기간: "operating_period",
  지원절차: "procedure", 접수기간: "application_period", 신청기간: "application_period", 접수방법: "application_method", 신청방법: "application_method",
  접수처: "application_place", 신청장소: "application_place", 제외대상: "exclusion", 신청자격: "eligibility", 자격: "eligibility", 문의: "provider", 담당: "provider",
};
const SECTIONS = { 신청자격: "eligibility", 제출서류: "required_documents", 구비서류: "required_documents" };
const BULLET = /^[❍○●•▪■□◦\-\*※]\s*/;
// 예시·빈 양식 표지: '예시', '(예)', '○○○'·'△△'·'OOO'·'□□' 같은 자리표시, '0000년' 같은 빈칸 숫자.
const EXAMPLE_OR_BLANK = /(^|\s|\()(예시|작성\s*예|기재\s*예|\(예\)|예\s*\))|[○△□◇]{2,}|O{3,}|0{4}\s*년|\(\s*\)\s*(원|명|세)/;
// 개정 전후 대조(신구조문대비표 등) 절: 그 아래 글은 현행 사실로 바로 쓰지 않는다.
const AMENDMENT_HEADING = /(신구\s*조문|개정\s*전|개정\s*후|개정안|현\s*행\s*[|·]?\s*개\s*정|전후\s*대조)/;

/** 사실 후보에서 뺄 이유. 원문 블록은 그대로 두고 후보만 제외한다(작업지시서 5.11, T63). */
export function exclusionReason(block, text, inAmendment) {
  if (block.contains_placeholder) return "PLACEHOLDER_FIELD";
  if (block.contains_strike) return "STRIKETHROUGH_TEXT";
  if (inAmendment) return "AMENDMENT_COMPARISON";
  if (EXAMPLE_OR_BLANK.test(text)) return "EXAMPLE_OR_BLANK_FORM";
  return null;
}

function argument(name) {
  const index = process.argv.indexOf(name);
  return index > 0 ? process.argv[index + 1] : undefined;
}

export function extractCandidates(document, excluded = []) {
  const out = [];
  let section = null;
  let inAmendment = false;
  for (const block of document.blocks) {
    if (block.type !== "paragraph" && block.type !== "heading") continue;
    const text = (block.parsed_text_verbatim ?? "").trim();
    if (!text) continue;
    if (block.type === "heading" || /^\d+\.\s*/.test(text)) inAmendment = AMENDMENT_HEADING.test(text);
    const heading = text.match(/^\d+\.\s*(.+)$/);
    if (heading) {
      section = Object.entries(SECTIONS).find(([label]) => heading[1].replace(/\s/g, "").includes(label))?.[1] ?? null;
      continue;
    }
    const body = text.replace(BULLET, "");
    const reason = exclusionReason(block, text, inAmendment);
    if (reason) {
      if (/[:：]/.test(body) || (section && BULLET.test(text))) excluded.push({ block_id: block.block_id, ir_pointer: block.ir_pointer, reason, text: text.slice(0, 120) });
      continue;
    }
    const pair = body.match(/^([가-힣 ]{2,8})\s*[:：]\s*(.+)$/);
    const predicate = pair ? LABELS[pair[1].replace(/\s/g, "")] : undefined;
    if (predicate) {
      out.push({ predicate_id: predicate, label: pair[1].trim(), value_text: pair[2].trim(), block, rule: "label_value" });
      continue;
    }
    if (section && BULLET.test(text) && !text.startsWith("※")) out.push({ predicate_id: section, label: section, value_text: body, block, rule: "section_bullet" });
  }
  return out.map((item, index) => ({
    candidate_id: "c" + String(index + 1).padStart(3, "0"),
    predicate_id: item.predicate_id, source_label: item.label, value_text: item.value_text.slice(0, 1000), rule: item.rule,
    evidence: { block_id: item.block.block_id, ir_pointer: item.block.ir_pointer, table_id: null, cell: null, layout_page_start: item.block.page ?? null, quote: (item.block.parsed_text_verbatim ?? "").trim().slice(0, 300) },
    review_status: "candidate",
  }));
}

// 보도자료용 규칙(작업지시서 v5 T76): 보도자료는 '항목: 값' 줄이 드물어 문단·표 셀 단위로 필드 신호를 찾는다.
// 재현율을 높이려는 검토 보조용이다. 같은 문단이 여러 필드 후보가 될 수 있고, 사람이 확인하기 전에는 공개되지 않는다.
const SIDO = "(서울|부산|대구|인천|광주|대전|울산|세종|경기|강원|충북|충남|전북|전남|경북|경남|제주)";
const PRESS_RULES = {
  amount: /\d[\d,.]*\s*(만|억|천|백)?\s*원|\d+(\.\d+)?\s*%/,
  effective_date: /(\d{4}\s*년|['‘’]\d{2}\s*년)?\s*\d{1,2}\s*월(\s*\d{1,2}\s*일)?\s*(부터|시행|중|말|까지)|시행/,
  eligibility: /대상|자격|해당하는|이하인|이상인|환자|가구|아동|노인|장애인|청년|사람/,
  benefit: /지원|제공|서비스|급여|수당|혜택|보장|치료/,
  agency: /^[가-힣·()\s]{2,30}(과|팀|단|국|실|부|센터|본부|위원회|의원|병원|원|공단|공사|재단|협회|조합)$|[가-힣]{2,}(부|원|공단|공사|재단|센터|지방정부|지자체)(는|은|와|과|이|가|에서)\s/,
  region: new RegExp(SIDO + "[가-힣]*\\s*[가-힣]{1,6}(시|군|구)"),
  legal_basis: /「[^」]*(법|령|규칙|고시|조례|규정)[^」]*」|[가-힣]+법(\s*시행령)?\s*제\s*\d+\s*조|[가-힣]+법(률)?/,
  program_name: /「[^」]+」|[가-힣A-Za-z0-9·]+\s*(시범사업|사업|제도|서비스|계좌|수당|급여)/,
  application: /신청|접수|제출|신고|방문|서식/,
  period_cycle: /\d+\s*(년|개월|주|회|일)|매년|매월|분기|만기|까지|동안/,
  scale: /\d[\d,]*\s*(명|개소|곳|개|가구|건|호)|규모/,
  exception: /제외|중단|다만|단,|예외|정지|연장|확대|변경|초과|제한/,
  scope: /\d+\s*개월|이내|포함|범위|분야|종별|과정|대학원/,
};

/** 보도자료 문단과 표 셀에서 필드별 후보를 뽑는다. tables는 tables.jsonl의 표 목록이다. */
export function extractPressCandidates(document, tables = []) {
  const units = [];
  for (const block of document.blocks) {
    if (block.type !== "paragraph" && block.type !== "heading") continue;
    const text = (block.parsed_text_verbatim ?? "").trim();
    if (text) units.push({ text, block_id: block.block_id, ir_pointer: block.ir_pointer, table_id: null, cell: null, page: block.page ?? null, block });
  }
  for (const table of tables) {
    for (const cell of table.cells ?? []) {
      const text = (cell.parsed_text_verbatim ?? "").trim();
      if (text) units.push({ text, block_id: null, ir_pointer: table.ir_pointer, table_id: table.table_id, cell: cell.cell_id, page: null, block: cell });
    }
  }
  const out = [];
  for (const unit of units) {
    if (exclusionReason(unit.block, unit.text, false)) continue;
    for (const [field, rule] of Object.entries(PRESS_RULES)) {
      if (!rule.test(unit.text)) continue;
      out.push({
        candidate_id: "p" + String(out.length + 1).padStart(4, "0"),
        predicate_id: field, source_label: field, value_text: unit.text.slice(0, 1000), rule: "press_" + field,
        evidence: { block_id: unit.block_id, ir_pointer: unit.ir_pointer, table_id: unit.table_id, cell: unit.cell, layout_page_start: unit.page, quote: unit.text.slice(0, 300) },
        review_status: "candidate",
      });
    }
  }
  return out;
}

if (import.meta.url === "file://" + process.argv[1]?.replace(/\\/g, "/") || process.argv[1]?.endsWith("candidates.mjs")) {
  const parsed = argument("--parsed");
  const out = argument("--out");
  if (!parsed || !out) {
    console.error("사용: node factory/release/candidates.mjs --parsed <parsed/p_xxx> --out <후보.json>");
    process.exit(2);
  }
  const manifest = JSON.parse(readFileSync(join(parsed, "manifest.json"), "utf8"));
  const document = JSON.parse(readFileSync(join(parsed, "document.json"), "utf8"));
  const excluded = [];
  const candidates = extractCandidates(document, excluded);
  writeFileSync(out, JSON.stringify({ parse_id: manifest.parse_id, source_version_id: manifest.source_version_id, raw_sha256: manifest.raw_sha256, candidates, excluded }, null, 2) + "\n");
  console.log("후보 " + candidates.length + "건, 제외 " + excluded.length + "건 → " + out);
}
