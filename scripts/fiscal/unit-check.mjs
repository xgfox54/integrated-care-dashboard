#!/usr/bin/env node
// 지방재정365 금액 단위·값 공식 화면 대조(작업지시서 v5 §22·T84).
// 사용: node scripts/fiscal/unit-check.mjs <관측 JSON> <기준일 YYYY-MM-DD> [사업명 검색어=통합돌봄]
// 관측 JSON: [[fiscal_project_id, 예산현액, 지출액, 국비, 시도비, 시군구비, 기타], ...] (운영 DB fiscal_observation에서 해당 snapshot 행)
// 공식 화면 LF3120202(세부사업별 세출현황, robots.txt 전체 허용)을 시·도별로 0.7초 간격으로 조회하고 화면에 담긴 원값과 행·칸 단위로 대조한다.
import { readFileSync, writeFileSync } from "node:fs";

const [, , obsPath, date, keyword = "통합돌봄"] = process.argv;
if (!obsPath || !/^\d{4}-\d{2}-\d{2}$/.test(date ?? "")) {
  console.error("사용: node scripts/fiscal/unit-check.mjs <관측 JSON> <YYYY-MM-DD> [검색어]");
  process.exit(64);
}
const URL_ = "https://www.lofin365.go.kr/lf/lnncGramStst/laf/exeSvi/retvLstDtlsBybsnAneSitu.do";
const CAPS = ["11", "13", "26", "27", "28", "30", "31", "32", "41", "42", "43", "44", "45", "47", "48", "49"];
async function page(cap, number) {
  const body = new URLSearchParams({
    menuUrl: "/lf/lnncGramStst/laf/exeSvi/retvLstDtlsBybsnAneSitu.do", menuNm: "세부사업별 세출현황", menuParaCn: "STST", menuId: "LF3120202", uprMenuId: "LF3120200",
    crtrLvl: "", subCode: cap, inqYr: date.slice(0, 4), curPage: String(number), inqBgngYmd: date.replaceAll("-", ""), inqEndYmd: "", inqCap: cap, inqSgg: "",
    inqDtaCd: "", inqDtaCd2: "", inqYmd: date, srchCrstCn: keyword, sysDvCd: "", logReg: "false",
  });
  const response = await fetch(URL_, { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded; charset=UTF-8", referer: "https://www.lofin365.go.kr/portal/LF3120202.do" }, body });
  if (!response.ok) throw new Error("공식 화면 응답 " + response.status);
  const match = (await response.text()).match(/var list = (\[[\s\S]*?\]);/);
  if (!match) throw new Error("화면 자료를 찾지 못했습니다(화면 구조 변경 가능).");
  return JSON.parse(match[1]);
}
const official = [];
for (const cap of CAPS) {
  for (let number = 1; number < 200; number += 1) {
    const list = await page(cap, number);
    await new Promise((resolve) => setTimeout(resolve, 700));
    for (const row of list) official.push({ key: row.lafCd + "|" + row.code, values: [row.amt1, row.amt6, row.amt2, row.amt3, row.amt4, row.amt5].map(String) });
    if (list.length < 10) break;
  }
}
const ours = JSON.parse(readFileSync(obsPath, "utf8")).map((row) => {
  const parts = row[0].split(":");
  return { key: parts[2] + "|" + parts[5], values: [row[1], row[2], row[3], row[4], row[5], row[6]].map(String) };
});
const pool = new Map();
for (const row of official) (pool.get(row.key) ?? pool.set(row.key, []).get(row.key)).push(row.values.join(","));
let exact = 0;
const mismatches = [];
const onlyApi = [];
for (const row of ours) {
  const candidates = pool.get(row.key);
  if (!candidates) { onlyApi.push(row.key); continue; }
  const at = candidates.indexOf(row.values.join(","));
  if (at >= 0) { exact += 1; candidates.splice(at, 1); } else mismatches.push({ key: row.key, api: row.values, official: candidates });
}
const onlyOfficial = [...pool.entries()].flatMap(([key, rest]) => rest.map(() => key)).filter((key) => !ours.some((row) => row.key === key));
const report = { reference_date: date, keyword, api_rows: ours.length, official_rows: official.length, exact_rows: exact, field_checks: exact * 6 + mismatches.length * 6, mismatches: mismatches.length, only_api: onlyApi.length, only_official: onlyOfficial.length };
writeFileSync("unit-check-" + date + ".json", JSON.stringify({ report, mismatches, onlyApi, onlyOfficial }, null, 1));
console.log(JSON.stringify(report));
process.exit(mismatches.length || onlyApi.length ? 1 : 0);
