// 행정안전부 주민등록 인구통계 '지역별 고령 인구현황'(etcStatOldAge.do)에서 시·군·구(행정시 포함)별 총인구·65세 이상 인구를 받아
// 광역 합계와 대조한 뒤 lib/statistics/sigungu-elderly-verified.ts를 만든다. 대조에 실패한 광역은 넣지 않는다.
// 실행: node scripts/statistics/build-sigungu-elderly-snapshot.mjs [YYYY-MM]
import { createHash } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";

const BASE = "https://jumin.mois.go.kr/";
const period = process.argv[2] ?? "2026-09";
const [year, month] = period.split("-");
const outDir = "docs/statistics/sigungu-elderly-" + period;
const headers = { "user-agent": "Mozilla/5.0 (integrated-care-dashboard statistics snapshot)", "content-type": "application/x-www-form-urlencoded; charset=UTF-8" };
let cookie = "";
async function post(path, body) {
  const response = await fetch(BASE + path, { method: "POST", headers: { ...headers, cookie }, body: new URLSearchParams(body) });
  cookie = (response.headers.get("set-cookie") ?? cookie).split(";")[0] || cookie;
  if (!response.ok) throw new Error(path + " HTTP " + response.status);
  return response.text();
}
const first = await fetch(BASE + "etcStatOldAge.do", { headers });
cookie = (first.headers.get("set-cookie") ?? "").split(";")[0];
const locations = JSON.parse(await post("selectHangkikcdListAjax.do", {})).locations;
const provinces = locations.filter((entry) => entry.levels === 1 || entry.levels === "1");
const children = locations.filter((entry) => entry.levels === 2 || entry.levels === "2");
const number = (value) => Number(String(value).replace(/,/g, ""));
const records = [];
const evidence = [];
const failures = [];
await mkdir(outDir, { recursive: true });
for (const province of provinces) {
  const html = await post("etcStatOldAge.do", {
    tableChart: "T", sltOrgType: "2", sltOrgLvl1: province.hangkikcd, sltOrgLvl2: "A", nowYear: year, searchYearMonth: "month",
    searchYearStart: year, searchMonthStart: month, searchYearEnd: year, searchMonthEnd: month, sltOrderType: "1", sltOrderValue: "ASC",
  });
  const body = html.slice(html.indexOf("<tbody"), html.indexOf("</tbody>"));
  const rows = [...body.matchAll(/<tr[^>]*>([\s\S]*?)<\/tr>/g)].map((match) => [...match[1].matchAll(/<td[^>]*>([\s\S]*?)<\/td>/g)].map((cell) => cell[1].replace(/<[^>]+>/g, "").trim()));
  const parsed = rows.filter((cells) => cells.length >= 8).map((cells) => ({ name: cells[1], total: number(cells[2]), elderly: number(cells[5]), elderlyMale: number(cells[6]), elderlyFemale: number(cells[7]) }));
  const head = parsed[0];
  const text = rows.map((cells) => cells.join("\t")).join("\n");
  const sha256 = createHash("sha256").update(text).digest("hex");
  await writeFile(outDir + "/" + province.hangkikcd + ".tsv", text + "\n");
  evidence.push({ province: province.sidonm, code: province.hangkikcd, rows: parsed.length, sha256 });
  if (!head || head.name !== province.sidonm) { failures.push({ province: province.sidonm, reason: "첫 행이 광역 합계가 아님" }); continue; }
  const known = new Map(children.filter((entry) => entry.sidonm === province.sidonm).map((entry) => [entry.sikunkunm, entry.hangkikcd]));
  const subs = parsed.slice(1).filter((row) => known.has(row.name));
  const totalSum = subs.reduce((sum, row) => sum + row.total, 0);
  const elderlySum = subs.reduce((sum, row) => sum + row.elderly, 0);
  const consistent = subs.every((row) => row.elderly === row.elderlyMale + row.elderlyFemale) && head.elderly === head.elderlyMale + head.elderlyFemale;
  if (subs.length && (totalSum !== head.total || elderlySum !== head.elderly || !consistent)) {
    failures.push({ province: province.sidonm, reason: "시·군·구 합계가 광역 합계와 다름", totalSum, total: head.total, elderlySum, elderly: head.elderly });
    continue;
  }
  records.push({ sido: province.sidonm, sigungu: "", code: province.hangkikcd, level: "sido", total: head.total, elderly: head.elderly });
  for (const row of subs) records.push({ sido: province.sidonm, sigungu: row.name, code: known.get(row.name), level: "sigungu", total: row.total, elderly: row.elderly });
  await new Promise((resolve) => setTimeout(resolve, 400));
}
const checkedAt = new Date().toISOString();
const lastDay = new Date(Date.UTC(Number(year), Number(month), 0)).getUTCDate();
const snapshot = { period, referenceDate: period + "-" + String(lastDay).padStart(2, "0"), checkedAt, source: BASE + "etcStatOldAge.do", sourceTitle: "행정안전부 주민등록 인구통계 · 지역별 고령 인구현황", coverage: "거주자·거주불명자·재외국민 포함, 외국인 제외(주민등록인구)", ageBasis: "만 65세 이상", records, failures, evidence };
await writeFile(outDir + "/snapshot.json", JSON.stringify(snapshot, null, 1) + "\n");
await writeFile("lib/statistics/sigungu-elderly-verified.ts",
  "// 생성: scripts/statistics/build-sigungu-elderly-snapshot.mjs. 원문 대조 기록: " + outDir + "/snapshot.json\n" +
  "export const SIGUNGU_ELDERLY_SNAPSHOT = " + JSON.stringify({ period: snapshot.period, referenceDate: snapshot.referenceDate, checkedAt, source: snapshot.source, sourceTitle: snapshot.sourceTitle, coverage: snapshot.coverage, records }, null, 1) + " as const;\n");
console.log(JSON.stringify({ provinces: provinces.length, records: records.length, failures }, null, 1));

