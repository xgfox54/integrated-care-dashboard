import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

import { runJob } from "../../factory/hwp-parser/src/run-job.mjs";

// 공식 공고의 계획 본문 첨부만 내려받아 기존 격리 kordoc 워커로 확인한다.
// 원문과 전체 추출물은 git에서 제외된 var/ 아래에 보존한다.
const root = resolve("var/welfare-factory");
const announcement = "https://eminwon.brcn.go.kr/emwp/gov/mogaha/ntis/web/ofr/action/OfrAction.do?context=NTIS&jndinm=OfrNotAncmtEJB&method=selectOfrNotAncmt&methodnm=selectOfrNotAncmtRegst&not_ancmt_mgt_no=54040&subCheck=N";
const expectedHash = "d876af3ee3dc0a9cfff5f8a8d4dbf73ea8920afa9ea632725f93ce13c8750b76";
const headers = { "user-agent": "IntegratedCareDashboard-SourceVerification/1.0" };
const page = await fetch(announcement, { headers, signal: AbortSignal.timeout(30000) });
assert.equal(page.status, 200, "공식 공고 HTTP 응답");
const pageBytes = new Uint8Array(await page.arrayBuffer());
let html = new TextDecoder().decode(pageBytes);
if (html.includes("\uFFFD")) html = new TextDecoder("euc-kr").decode(pageBytes);
const attachments = [...html.matchAll(/goDownLoad\('([^']*)','([^']*)','([^']*)'\)/g)];
assert.equal(attachments.length, 2, "공고문과 계획 본문 첨부 2개 확인");
const [, userFile, systemFile, filePath] = attachments[1];
const body = new URLSearchParams({ user_file_nm: userFile, sys_file_nm: systemFile, file_path: filePath, isHome: "Y" });
await new Promise((done) => setTimeout(done, 3000));
const downloaded = await fetch("https://eminwon.brcn.go.kr/emwp/jsp/ofr/FileDownNew.jsp", { method: "POST", body, headers, signal: AbortSignal.timeout(30000) });
assert.equal(downloaded.status, 200, "공식 계획 첨부 HTTP 응답");
const bytes = Buffer.from(await downloaded.arrayBuffer());
assert.equal(bytes.subarray(0, 8).toString("hex"), "d0cf11e0a1b11ae1", "HWP CFB 시그니처");
const sha256 = createHash("sha256").update(bytes).digest("hex");
assert.equal(sha256, expectedHash, "조사에서 확인한 계획 본문 원문 해시");
mkdirSync(resolve(root, "raw/boryeong-cbr-2026"), { recursive: true });
mkdirSync(resolve(root, "jobs"), { recursive: true });
const inputRef = "raw/boryeong-cbr-2026/plan-d876af3ee3dc0a9c.hwp";
if (existsSync(resolve(root, inputRef))) {
  assert.equal(createHash("sha256").update(readFileSync(resolve(root, inputRef))).digest("hex"), sha256, "기존 원문 보존 및 해시 일치");
} else {
  writeFileSync(resolve(root, inputRef), bytes, { flag: "wx" });
}
const jobPath = resolve(root, "jobs/boryeong-cbr-2026.json");
writeFileSync(jobPath, JSON.stringify({ job_id: "boryeong-cbr-2026", source_version_id: "brcn-notice-2026-18", input_ref: inputRef, expected_sha256: sha256, profile_id: "hwp-ingest", output_root: "parsed" }, null, 2));
const result = await runJob({ jobPath, root });
assert.equal(result.ok, true, "격리 kordoc 구조 파싱");
const reportDir = resolve(".omo/evidence/wiki-boryeong-cbr-20261006");
mkdirSync(reportDir, { recursive: true });
const summary = {
  announcement, source_sha256: sha256, size_bytes: bytes.length,
  status: result.status, parse_id: result.parse_id, reused: result.reused,
  parser: result.manifest.parser.package_version,
  performance: result.manifest.performance,
  document_facts_published: false,
};
writeFileSync(resolve(reportDir, "verification.json"), JSON.stringify(summary, null, 2));
console.log(JSON.stringify(summary));
