import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import { assessManualLink } from "../../lib/manual-link-type.ts";
import { ORIGINALS_REVISION, displayLines, originalPages, readCorpus } from "../welfare100/manual-pages.mjs";

const source = readCorpus("data/manual-corpus/assets/__manual_corpus", ORIGINALS_REVISION);
const pages = new Map(originalPages(source).map(page => [page.file + "|" + page.page, page]));
const catalog = JSON.parse(readFileSync("data/manual-corpus/catalog.json", "utf8"));
const spaces = text => text.normalize("NFKC").replace(/\s+/g, " ").trim();
const rows = [];
for (const file of readdirSync("public/data/welfare100/items").filter((name) => name.endsWith(".json")).sort()) {
  const payload = JSON.parse(readFileSync("public/data/welfare100/items/" + file, "utf8"));
  const name = payload.kind === "curated" ? payload.meta.name : payload.raw?.name;
  const refs = payload.kind === "curated" ? payload.extra.talkRefs : payload.raw?.talkRefs ?? [];
  for (const ref of refs) {
    const link = assessManualLink(ref, name ?? "");
    const page = ref.original && pages.get(ref.original.file + "|" + ref.original.page);
    const quoteBody = ref.original?.quote?.replace(/^…\s*|\s*…$/g, "");
    const quoteMatch = quoteBody?.trim() && page ? spaces(displayLines(page.raw).join("\n")).includes(spaces(quoteBody)) : false;
    rows.push({ program_id: file.replace(/\.json$/, ""), program_name: name ?? "", manual_key: ref.key, manual_title: ref.title,
      line: ref.line, heading: ref.heading ?? "", match: ref.match, link_type: link.type, link_label: link.label,
      confirmed: link.confirmed, basis: link.basis, title_year: link.titleYear, year_note: link.yearNote,
      original: ref.original ?? null, provenance: link.provenance, parsed_original_document_id: page?.documentId ?? null,
      parsed_page_status: !ref.original ? "MISSING" : !page ? "PAGE_NOT_FOUND" : !quoteBody?.trim() ? "NO_QUOTE" : quoteMatch ? "QUOTE_TEXT_MATCH" : "QUOTE_TEXT_MISMATCH",
      table_position: null, footnote_position: null });
  }
}
const unique = [...new Map(rows.map((row) => [row.program_id + "|" + row.manual_key + "|" + row.line, row])).values()];
const count = (pick) => unique.reduce((map, row) => { const key = pick(row); map[key] = (map[key] ?? 0) + 1; return map; }, {});
const summary = {
  generated_at: new Date().toISOString(), links: unique.length, programs: new Set(unique.map((row) => row.program_id)).size,
  by_type: count((row) => row.link_type + " " + row.link_label), confirmed: unique.filter((row) => row.confirmed).length, candidates: unique.filter((row) => !row.confirmed).length,
  manuals_referenced: new Set(unique.map((row) => row.manual_key)).size,
  by_provenance: count(row => row.provenance.status), by_parsed_page_status: count(row => row.parsed_page_status),
  mcp_catalog_documents: catalog.documents.length, mcp_catalog_revision: catalog.revision,
  original_documents: source.documents.size, original_revision: ORIGINALS_REVISION,
  named_programs: unique.every(row => row.program_name.length > 0),
  note: "39개 합본 키의 연결과 공개 MCP 113개 문서는 관리 단위가 다릅니다. 보관 원본 파싱 코퍼스 114개와 공개 MCP 113개는 서로 다른 판본·파일명 체계이며 1:1 대응을 검증하지 않았습니다. 1개 문서 누락을 뜻하지 않습니다. confirmed는 제목·절 규칙상 직접 설명 분류이며 내용 검수완료 표시가 아닙니다. QUOTE_TEXT_MATCH는 저장된 원본 파싱 쪽 텍스트와 발췌의 대조이며 PDF 화면·적용연도·사업 동일성 검증이 아닙니다. 표 좌표·각주 위치는 저장 필드가 없어 null입니다. 이전 보고서의 curated extra 제도명 누락을 수정하고 실제 웹/MCP가 쓰는 talkRefs만 집계했으므로 이전 합계와 단순 비교하지 마세요.",
};
const output = "docs/data-quality/manual-link-review-20261015";
writeFileSync(output + ".json", JSON.stringify({ summary, rows: unique }, null, 1) + "\n");
writeFileSync(output + ".md", `# 매뉴얼 연결 재검토 2026-10-15\n\n총 ${summary.links}건, 사업 ${summary.programs}개. 제목·절 기준 연결 ${summary.confirmed}건, 확인 후보 ${summary.candidates}건.\n\n${summary.note}\n\n\`\`\`json\n${JSON.stringify(summary, null, 2)}\n\`\`\`\n\n행별 원본 파일·쪽 범위·발췌·파싱 문서 ID·대조 상태는 동명 JSON에 보존합니다. 원본 쪽과 표·각주를 직접 검토하지 않은 후보는 확정하지 않았습니다.\n`);
console.log(JSON.stringify(summary, null, 1));

