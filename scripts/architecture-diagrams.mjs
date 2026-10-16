import { mkdirSync, writeFileSync } from "node:fs";

// These diagrams describe public data flows. Arrows do not imply foreign keys.
const escape = (s) => s.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");
const text = (x, y, value, cls = "body", anchor = "start") => `<text x="${x}" y="${y}" class="${cls}" text-anchor="${anchor}">${escape(value)}</text>`;
const rect = (x, y, w, h, fill = "#fff", stroke = "#d2dfeb", radius = 14) => `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="${radius}" fill="${fill}" stroke="${stroke}"/>`;
const arrow = (d, dashed = false) => `<path d="${d}" fill="none" stroke="#7188a0" stroke-width="2" ${dashed ? 'stroke-dasharray="5 5"' : ""} marker-end="url(#arrow)"/>`;
function frame(title, description, height, content) {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="1040" height="${height}" viewBox="0 0 1040 ${height}" role="img" aria-labelledby="title description"><title id="title">${escape(title)}</title><desc id="description">${escape(description)}</desc><defs><marker id="arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse"><path d="M 0 0 L 10 5 L 0 10 z" fill="#7188a0"/></marker></defs><style>text{font-family:"Noto Sans KR","Malgun Gothic",Arial,sans-serif;fill:#16324c}.title{font-size:28px;font-weight:700}.subtitle{font-size:16px;fill:#526b82}.heading{font-size:20px;font-weight:700}.body{font-size:17px}.code{font-size:14px;fill:#526b82}.small{font-size:15px;fill:#526b82}.step{font-size:14px;font-weight:700;fill:#087f72}</style><rect width="1040" height="${height}" fill="#f5f8fc"/>${content}</svg>\n`;
}
function card(x, y, title, lines, codes) {
  return rect(x, y, 300, 134) + text(x + 20, y + 32, title, "heading")
    + lines.map((line, i) => text(x + 20, y + 61 + i * 23, line)).join("")
    + codes.map((line, i) => text(x + 20, y + 105 + i * 18, line, "code")).join("");
}
let db = text(40, 52, "DB 구조 · 출처와 시점을 함께 보관", "title")
  + text(40, 82, "공식 자료 → 분야별 저장 → 근거와 공개 버전 → 웹·MCP", "subtitle")
  + rect(40, 108, 960, 64, "#e7f4f1", "#b9ddd3")
  + text(520, 136, "공식 공개 자료의 수집 · 정규화 · 검증", "heading", "middle")
  + text(520, 158, "출처 / 지역 / 기준일 / 회계연도 / 단위를 함께 기록", "small", "middle")
  + text(40, 208, "D1 데이터베이스", "heading")
  + text(1000, 208, "각 분야의 이력을 구분해 저장", "small", "end");
db += arrow("M520 172 V186 H200 V227") + arrow("M520 186 V227") + arrow("M520 186 H840 V227");
db += card(40, 230, "사업 · 공식 원문", ["수집 버전을 함께 참조"], ["official_service_snapshot", "official_source_document"])
  + card(370, 230, "매뉴얼", ["자료집 버전 → 문서 → 절"], ["manual_corpus / manual_document", "manual_section"])
  + card(700, 230, "예산", ["사업 → 금액 관측값"], ["fiscal_project / fiscal_observation", "fiscal_snapshot"])
  + card(40, 386, "뉴스", ["기관 → 수집원 → 게시물"], ["press_organization / press_source", "press_item"])
  + card(370, 386, "문서의 근거", ["문서 → 사실 → 근거 위치"], ["doc_source / doc_statement", "doc_evidence"])
  + card(700, 386, "외부 연계 · 통계", ["데이터셋 → 수집 실행 → 기록"], ["ext_dataset / ext_run / ext_record", "지역 코드 · 통계 관측값"]);
db += rect(40, 540, 960, 68, "#edf2fb", "#cbd8ed")
  + text(60, 569, "분야 간 연결 근거 · 공개할 자료 버전", "heading")
  + text(60, 593, "cross_domain_link  /  platform_release_bundle", "code")
  + arrow("M520 520 V537", true)
  + rect(40, 632, 460, 76)
  + text(60, 662, "정적 JSON · 문서 자료", "heading")
  + text(60, 689, "복지제도 대장 · 업무구조도 · 매뉴얼 자료")
  + rect(540, 632, 460, 76, "#e7f4f1", "#b9ddd3")
  + text(770, 662, "공통 조회 → 웹 화면 · MCP", "heading", "middle")
  + text(770, 689, "출처와 기준 시점을 함께 제공", "body", "middle")
  + arrow("M770 608 V629") + arrow("M500 670 H537")
  + text(40, 744, "읽는 법: 화살표는 논리적 자료 흐름입니다. 모든 연결이 DB 외래키를 뜻하지는 않습니다.", "small")
  + text(40, 771, "검색 후보와 확인된 연결은 구분하며, 이름이 비슷하다는 이유만으로 관계를 확정하지 않습니다.", "small");

let mcp = text(40, 52, "MCP 구조 · AI와 공개 자료를 연결", "title")
  + text(40, 82, "질문을 정해진 조회 도구로 바꾸고, 근거와 함께 결과를 돌려줍니다.", "subtitle");
const step = (y, number, title, detail) => rect(40, y, 960, 72)
  + text(62, y + 25, number, "step") + text(106, y + 30, title, "heading")
  + text(106, y + 56, detail);
mcp += step(110, "01", "이용자 → AI 클라이언트", "예: 서귀포시 생계지원 자료를 찾아줘  ·  ChatGPT / Claude 등")
  + arrow("M520 182 V201")
  + step(204, "02", "Korean Welfare MCP · 입력과 도구 확인", "공개 도구 목록과 입력 형식을 확인하고 지역·연도 등 조회 조건을 반영")
  + arrow("M520 276 V295")
  + step(298, "03", "분야별 조회 도구 → 검색과 근거 수집", "복지제도 / 매뉴얼·FAQ / 예산 / 뉴스 / 통계 / 돌봄자원")
  + arrow("M520 370 V389 H275 V405") + arrow("M520 389 H765 V405")
  + rect(40, 408, 470, 92, "#edf2fb", "#cbd8ed")
  + text(275, 443, "공개된 저장 자료", "heading", "middle")
  + text(275, 475, "D1 + 정적 JSON + 문서 자료", "body", "middle")
  + rect(530, 408, 470, 92, "#edf2fb", "#cbd8ed")
  + text(765, 443, "필요한 공식 통계 조회", "heading", "middle")
  + text(765, 475, "자료별 제공 범위 안에서 조회", "body", "middle")
  + arrow("M275 500 V521 H520 V539") + arrow("M765 500 V521 H520")
  + rect(40, 542, 960, 88, "#e7f4f1", "#b9ddd3")
  + text(62, 570, "04", "step")
  + text(106, 572, "구조화된 결과 → AI의 설명과 원문 링크", "heading")
  + text(106, 601, "자료 + 출처 + 기준 시점 + 자료 버전 + 누락·주의사항")
  + text(40, 668, "이용자는 조회 도구를 사용합니다. 서버 내부의 자료 현행화·검색 캐시와는 별도 흐름입니다.", "small")
  + text(40, 695, "AI의 설명은 수급 자격 판정이 아닙니다. 이용자가 원문의 조건·예외와 최신 기준을 확인합니다.", "small");
mkdirSync("docs/architecture", { recursive: true });
writeFileSync("docs/architecture/database.svg", frame("공개 데이터의 DB 구조", "공식 자료를 D1의 여섯 분야와 정적 JSON에 저장하고 연결 근거와 공개 버전을 통해 웹과 MCP에서 조회하는 논리 구조도", 804, db));
writeFileSync("docs/architecture/mcp.svg", frame("Korean Welfare MCP의 조회 흐름", "이용자 질문, AI 클라이언트, 입력 확인, 분야별 도구, 공개 자료와 공식 통계, 출처를 포함한 결과의 순서", 730, mcp));
console.log("Generated two public architecture diagrams.");
