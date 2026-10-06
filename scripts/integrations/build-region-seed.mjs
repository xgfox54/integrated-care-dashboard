// 행정표준코드관리시스템 공식 원문 표본(docs/integrations/samples/legal-dong-official-sample-*.json)으로 법정동 시·도·시·군·구 코드와
// 화면 지역 대응표 초기 자료 마이그레이션을 만든다. 같은 입력이면 같은 출력이 나온다.
// 사용: node --experimental-strip-types scripts/integrations/build-region-seed.mjs <표본 JSON> <마이그레이션 경로>
import { readFileSync, writeFileSync } from "node:fs";

import { contentLinkForLegal, isoDate, LEGAL_SIDO, legalLevel } from "../../lib/integrations/region-codes.ts";

const [samplePath, target] = process.argv.slice(2);
if (!samplePath || !target) throw new Error("사용: build-region-seed.mjs <표본 JSON> <마이그레이션 경로>");
const sample = JSON.parse(readFileSync(samplePath, "utf8"));
const retrieved = sample.source.retrieved_at;
const sourceUrl = sample.source.url;
const q = (value) => (value === null || value === undefined ? "NULL" : "'" + String(value).replace(/'/g, "''") + "'");

/** 폐지 포함 검색으로 생성일·폐지일을 확인한 코드. 같은 코드가 여러 검색에 나오면 처음 것을 쓴다. */
const history = new Map();
for (const rows of Object.values(sample.history)) {
  for (const row of rows) if (!history.has(row.code)) history.set(row.code, row);
}

const rows = new Map();
function add(code, name, level, validFrom, validTo, status, note) {
  const key = code + "|" + (validFrom ?? "");
  if (!rows.has(key)) rows.set(key, { code, name, level, validFrom: validFrom ?? "", validTo, status, note });
}

for (const [sido, info] of Object.entries(LEGAL_SIDO)) {
  const code = sido + "00000000";
  const h = history.get(code);
  if (h) add(code, h.name, "SIDO", isoDate(h.created), isoDate(h.abolished), "OFFICIAL_HISTORY", "폐지 포함 검색으로 생성일·폐지일 확인");
  else add(code, info.name, "SIDO", info.validFrom ?? null, info.validTo ?? null, info.validTo || info.validFrom ? "INFERRED" : "LISTED", "시·도 선택 목록(2026-10-05)에 있음. 적용기간 미확인");
}

for (const entry of sample.sigungu_current) {
  const sido = LEGAL_SIDO[entry.sido_cd];
  const fullName = sido.name + " " + entry.name;
  const h = history.get(entry.code);
  if (h) {
    add(entry.code, h.name, legalLevel(entry.code, h.name), isoDate(h.created), isoDate(h.abolished), "OFFICIAL_HISTORY", "폐지 포함 검색으로 생성일·폐지일 확인");
  } else if (sido.validTo) {
    add(entry.code, fullName, legalLevel(entry.code, fullName), null, sido.validTo, "INFERRED", "상위 시·도(" + sido.name + ")가 " + sido.validTo + " 폐지됨. 이 코드의 폐지일은 개별 확인 전");
  } else {
    add(entry.code, fullName, legalLevel(entry.code, fullName), null, null, "LISTED", "시·군·구 선택 목록(2026-10-05)에 있음. 생성일 미확인");
  }
}

// 회귀 사례: 폐지 포함 검색 결과 중 시·군·구 단위와 용지동(읍·면·동)
for (const [query, list] of Object.entries(sample.history)) {
  for (const row of list) {
    const isSigungu = /^\d{5}00000$/.test(row.code);
    if (!isSigungu && !(query === "용지동" && /용지동$/.test(row.name))) continue;
    add(row.code, row.name, legalLevel(row.code, row.name), isoDate(row.created), isoDate(row.abolished), "OFFICIAL_HISTORY", "폐지 포함 검색(" + query + ")");
  }
}

const statements = [];
statements.push("-- 법정동 시·도·시·군·구 코드 초기 자료와 화면 지역 대응표. 원천: " + sample.source.title + " (" + sourceUrl + "), 조회 " + retrieved + ".");
statements.push("-- LISTED: 선택 목록에 있으나 적용기간 미확인 / INFERRED: 상위 단위 폐지로 추정 / OFFICIAL_HISTORY: 폐지 포함 검색으로 날짜 확인. 공공데이터포털 법정동코드 API 수집이 들어오면 API 값이 따로 쌓인다.");
const sorted = [...rows.values()].sort((a, b) => (a.code + a.validFrom).localeCompare(b.code + b.validFrom));
for (const row of sorted) {
  statements.push("INSERT OR IGNORE INTO region_code (code_type, code, valid_from, valid_to, name, level, parent_code, validity_status, source_title, source_url, retrieved_at, note) VALUES ('LEGAL_DONG', " + [row.code, row.validFrom, row.validTo, row.name, row.level, row.level === "SIDO" ? null : row.code.slice(0, 2) + "00000000", row.status, sample.source.title, sourceUrl, retrieved, row.note].map(q).join(", ") + ");");
}
let maps = 0;
for (const row of sorted) {
  if (row.level === "EMD" || row.level === "RI") continue;
  const link = contentLinkForLegal(row.code, row.name);
  if (!link) continue;
  maps += 1;
  const mapId = "legal:" + row.code + "@" + (row.validFrom || "-") + "->" + link.regionId;
  statements.push("INSERT OR IGNORE INTO region_code_map (map_id, from_type, from_code, to_type, to_code, relation, valid_from, valid_to, status, basis, basis_url, note, created_at) VALUES (" + [mapId, "LEGAL_DONG", row.code, "CONTENT_REGION", link.regionId, link.relation, row.validFrom || null, row.validTo, link.status === "VERIFIED" && row.status !== "INFERRED" ? "VERIFIED" : "CANDIDATE", "NAME_RULE:" + row.status, sourceUrl, link.note].map(q).join(", ") + ", 1791183600);");
}
writeFileSync(target, statements.join("\n--> statement-breakpoint\n") + "\n");
console.log(JSON.stringify({ codes: sorted.length, maps, byStatus: sorted.reduce((acc, row) => ({ ...acc, [row.status]: (acc[row.status] ?? 0) + 1 }), {}) }));
