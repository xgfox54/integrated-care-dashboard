// 의미 필드 평가(작업지시서 v5 §18.5·T76): 표 구조 평가와 분리한다.
// 1) 근거 추적: 정답 인용이 파서 결과(문단·셀 글자)에 그대로 남아 있는가.
// 2) 후보 추출: factory/release/candidates.mjs가 뽑은 후보가 정답 필드를 찾는가(재현율), 뽑은 후보가 정답에 맞는가(정밀도).
import { createHash } from "node:crypto";
import { mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { extractCandidates, extractPressCandidates } from "../release/candidates.mjs";
import { ADAPTER_VERSION } from "../hwp-parser/src/profile.mjs";

const PARSER_VERSION = JSON.parse(readFileSync("factory/hwp-parser/parser-pin.json", "utf8")).package_version;
// 파서 버전마다 결과 폴더를 따로 둔다(이전 버전 결과를 덮어쓰지 않음).
const OUT_DIR = "docs/corpus/kordoc-" + PARSER_VERSION;
const root = path.resolve("var/welfare-factory");
const golden = JSON.parse(readFileSync("var/welfare-factory/golden/golden-semantic-korea-kr.json", "utf8"));
const squash = (s) => (s ?? "").replace(/<\/?[a-z]+>/gi, "").replace(/[\s\u00a0\u3000]+/g, "");
const parses = new Map();
for (const p of readdirSync(path.join(root, "parsed"))) {
  try {
    const m = JSON.parse(readFileSync(path.join(root, "parsed", p, "manifest.json"), "utf8"));
    if (m.adapter_version !== ADAPTER_VERSION || m.parser?.package_version !== PARSER_VERSION) continue;
    parses.set(m.raw_sha256, path.join(root, "parsed", p));
  } catch {}
}
// 같은 보도자료의 PDF판: 정답 인용이 PDF 파싱 글자(텍스트층·OCR)에도 남는지 따로 센다(PDF 경로 검증, 규칙 평가와 분리).
const corpusManifest = JSON.parse(readFileSync(path.join(root, "raw/korea-kr/manifest.json"), "utf8"));
const pdfSiblings = (docFile) => (corpusManifest.items.find((item) => item.files.some((file) => file.local === docFile))?.files ?? []).filter((file) => file.local.endsWith(".pdf"));
const pdfTotals = { docs_with_pdf: 0, pdf_files: 0, pdf_parsed: 0, golden_fields: 0, evidence_found: 0, evidence_found_in_ocr_pages: 0, press_found: 0, press_candidates: 0, press_matching: 0 };
const byDoc = new Map();
for (const f of golden.fields) (byDoc.get(f.doc) ?? byDoc.set(f.doc, []).get(f.doc)).push(f);
const totals = { golden_fields: 0, evidence_found: 0, candidates: 0, candidates_matching_golden: 0, golden_found_by_candidates: 0, press_candidates: 0, press_matching: 0, press_found: 0, by_field: {} };
const docs = [];
for (const [doc, fields] of byDoc) {
  const sha = createHash("sha256").update(readFileSync(path.join(root, "raw/korea-kr", doc))).digest("hex");
  const dirPath = parses.get(sha);
  if (!dirPath) throw new Error("파싱 결과 없음 " + doc);
  const document = JSON.parse(readFileSync(path.join(dirPath, "document.json"), "utf8"));
  const tables = readFileSync(path.join(dirPath, "tables.jsonl"), "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l));
  const parsedTexts = [...document.blocks.map((b) => squash(b.parsed_text_verbatim)), ...tables.flatMap((t) => t.cells.map((c) => squash(c.parsed_text_verbatim)))];
  const candidates = extractCandidates(document, []);
  const candTexts = candidates.map((c) => squash(c.value_text + " " + c.evidence.quote));
  const press = extractPressCandidates(document, tables).map((c) => ({ field: c.predicate_id, text: squash(c.value_text) }));
  const pressMatched = new Set();
  let docEvidence = 0, docFound = 0, docPress = 0;
  const matchedCandidates = new Set();
  for (const f of fields) {
    const q = squash(f.quote);
    const evidence = parsedTexts.some((t) => t.includes(q));
    const hits = candTexts.map((t, i) => (t.includes(q) ? i : -1)).filter((i) => i >= 0);
    hits.forEach((i) => matchedCandidates.add(i));
    // 보도자료 규칙은 필드 종류까지 맞아야 찾은 것으로 센다.
    const pressHits = press.map((c, i) => (c.field === f.field && c.text.includes(q) ? i : -1)).filter((i) => i >= 0);
    pressHits.forEach((i) => pressMatched.add(i));
    const s = (totals.by_field[f.field] ??= { golden: 0, evidence_found: 0, found_by_candidates: 0, found_by_press_rules: 0, press_candidates: 0 });
    s.golden += 1; if (evidence) s.evidence_found += 1; if (hits.length) s.found_by_candidates += 1;
    if (pressHits.length) { s.found_by_press_rules += 1; docPress += 1; }
    if (evidence) docEvidence += 1; if (hits.length) docFound += 1;
  }
  for (const c of press) (totals.by_field[c.field] ??= { golden: 0, evidence_found: 0, found_by_candidates: 0, found_by_press_rules: 0, press_candidates: 0 }).press_candidates += 1;
  totals.press_candidates += press.length; totals.press_matching += pressMatched.size; totals.press_found += docPress;
  totals.golden_fields += fields.length; totals.evidence_found += docEvidence; totals.golden_found_by_candidates += docFound;
  totals.candidates += candidates.length; totals.candidates_matching_golden += matchedCandidates.size;
  const pdfs = pdfSiblings(doc);
  let pdfEntry = null;
  if (pdfs.length) {
    pdfTotals.docs_with_pdf += 1; pdfTotals.pdf_files += pdfs.length;
    const pdfDirs = pdfs.map((file) => parses.get(file.sha256)).filter(Boolean);
    pdfTotals.pdf_parsed += pdfDirs.length;
    if (pdfDirs.length) {
      const texts = [];
      const ocrTexts = [];
      const pdfPress = [];
      for (const pdfDir of pdfDirs) {
        const pdfDocument = JSON.parse(readFileSync(path.join(pdfDir, "document.json"), "utf8"));
        const pdfTables = readFileSync(path.join(pdfDir, "tables.jsonl"), "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l));
        for (const block of pdfDocument.blocks) (block.ocr ? ocrTexts : texts).push(squash(block.parsed_text_verbatim));
        for (const table of pdfTables) for (const cell of table.cells) texts.push(squash(cell.parsed_text_verbatim));
        pdfPress.push(...extractPressCandidates(pdfDocument, pdfTables).map((c) => ({ field: c.predicate_id, text: squash(c.value_text) })));
      }
      // 문단·셀 경계가 HWPX와 달라 인용이 두 블록에 걸칠 수 있어 문서 전체 글자도 함께 본다.
      const whole = texts.join("") + ocrTexts.join("");
      let found = 0, inOcr = 0, pressFound = 0;
      const pdfPressMatched = new Set();
      for (const f of fields) {
        const q = squash(f.quote);
        if (texts.some((t) => t.includes(q)) || whole.includes(q)) found += 1;
        else if (ocrTexts.some((t) => t.includes(q))) { found += 1; inOcr += 1; }
        const hits = pdfPress.map((c, i) => (c.field === f.field && c.text.includes(q) ? i : -1)).filter((i) => i >= 0);
        hits.forEach((i) => pdfPressMatched.add(i));
        if (hits.length) pressFound += 1;
      }
      pdfTotals.golden_fields += fields.length; pdfTotals.evidence_found += found; pdfTotals.evidence_found_in_ocr_pages += inOcr;
      pdfTotals.press_found += pressFound; pdfTotals.press_candidates += pdfPress.length; pdfTotals.press_matching += pdfPressMatched.size;
      pdfEntry = { files: pdfDirs.length, evidence_found: found, golden: fields.length, press_found: pressFound };
    }
  }
  docs.push({ doc, pdf: pdfEntry, golden: fields.length, evidence_found: docEvidence, candidates: candidates.length, candidates_matching_golden: matchedCandidates.size, golden_found_by_candidates: docFound, press_candidates: press.length, golden_found_by_press_rules: docPress });
}
const pct = (a, b) => (b ? Math.round((a / b) * 1000) / 10 : null);
const report = {
  generated_at: new Date().toISOString(),
  golden: { file: "var/welfare-factory/golden/golden-semantic-korea-kr.json", fields: totals.golden_fields, docs: byDoc.size },
  evidence_trace: { found: totals.evidence_found, total: totals.golden_fields, rate_pct: pct(totals.evidence_found, totals.golden_fields), meaning: "정답 인용이 파서 결과 글자에 그대로 있는 비율(구조·글자 계층)" },
  candidate_extraction: { candidates: totals.candidates, precision_pct: pct(totals.candidates_matching_golden, totals.candidates), recall_pct: pct(totals.golden_found_by_candidates, totals.golden_fields), meaning: "factory/release/candidates.mjs(공고문 항목 규칙) 후보의 정밀도·재현율. 보류·누락도 재현율 분모에 포함" },
  press_candidate_extraction: { candidates: totals.press_candidates, precision_pct: pct(totals.press_matching, totals.press_candidates), recall_pct: pct(totals.press_found, totals.golden_fields), meaning: "extractPressCandidates(보도자료 문단·표 셀 신호 규칙) 후보의 정밀도·재현율. 필드 종류가 같고 정답 인용을 포함해야 맞은 것으로 셈. 검토 보조용이라 정밀도는 낮게 설계됨" },
  evaluation_sets: {
    tuned: "정답 24문서(HWPX)는 보도자료 규칙(기관 이름 규칙)을 한 번 넓힐 때 본 표본이다. 이 수치는 규칙 조정에 쓴 표본의 재평가이며 새 문서 성능이 아니다.",
    pdf_same_documents: "같은 보도자료의 PDF판(kordoc PDF 경로). 형식은 새것이지만 내용은 규칙 조정에 쓴 문서와 같아 독립 평가가 아니다.",
    new_documents: "규칙 조정에 쓰지 않은 새 문서의 독립 정답은 아직 없다(미검증). 새 정답 표본이 필요하다.",
  },
  pdf_route: { ...pdfTotals, evidence_rate_pct: pct(pdfTotals.evidence_found, pdfTotals.golden_fields), press_recall_pct: pct(pdfTotals.press_found, pdfTotals.golden_fields), press_precision_pct: pct(pdfTotals.press_matching, pdfTotals.press_candidates), meaning: "같은 보도자료 PDF판 파싱 글자에 정답 인용이 남은 비율과, 같은 보도자료 규칙을 PDF 결과에 돌린 재현율·정밀도" },
  target: "작업지시서 목표: 복지 필드 정밀도·재현율 각 98% 이상. 미달이면 자동 반영 비활성(현재 모든 후보는 사람 검토 후에만 공개)",
  by_field: totals.by_field, docs,
};
report.parser_version = PARSER_VERSION;
mkdirSync(OUT_DIR, { recursive: true });
writeFileSync(path.join(OUT_DIR, "semantic-eval-korea-kr.json"), JSON.stringify(report, null, 1));
console.log(JSON.stringify({ pdf_route: report.pdf_route, evidence_trace: report.evidence_trace, candidate_extraction: report.candidate_extraction, press: report.press_candidate_extraction, by_field: report.by_field }));
