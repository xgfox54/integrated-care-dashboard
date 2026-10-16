// Converts publicly rendered KOSIS tables saved in docs/statistics/kosis/*.json
// into lib/statistics/kosis-data.ts. Values are copied from the observed cells;
// "-" stays a missing value and is never converted to 0. Points are stored as
// [period, raw, status] and expanded by lib/statistics/kosis.ts.
import { readFileSync, writeFileSync } from "node:fs";

const EVIDENCE = new URL("../../docs/statistics/kosis/", import.meta.url);
const OUTPUT = new URL("../../lib/statistics/kosis-data.ts", import.meta.url);
const NATIONAL = new Set(["전체", "전국", "계", "합계", "총계"]);

/** One dataset per approved MOHW statistic. Filters keep the selector readable; the full table stays one click away. */
const DATASETS = [
  { id: "kosis:foster-adoption", approved: "가정위탁국내입양현황", category: "아동", tables: [{ id: "DT_11770N001" }, { id: "DT_11770_N005_1", nationalOnly: true }] },
  { id: "kosis:protected-children", approved: "보호대상아동 현황보고", indicators: ["보호대상아동 현황보고"], category: "아동", tables: [{ id: "TX_117341138", nationalOnly: true }] },
  { id: "kosis:child-welfare-facilities", approved: "아동복지시설보호아동및종사자현황보고", category: "아동", tables: [{ id: "TX_117401121", nationalOnly: true }] },
  { id: "kosis:registered-disabled", approved: "장애인현황", indicators: ["장애인 현황"], category: "장애인", tables: [{ id: "DT_11761_N001" }] },
  { id: "kosis:disability-survey", approved: "장애인실태조사 (지정통계)", category: "장애인", tables: [{ id: "DT_11732S0102" }] },
  { id: "kosis:disability-abuse", approved: "장애인학대현황", category: "장애인", tables: [{ id: "DT_117108_A001" }] },
  { id: "kosis:disability-health", approved: "장애인건강보건통계", category: "보건·의료", tables: [{ id: "DT_117102_A001", rowInclude: / \/ 소계$/, colInclude: /^계 \/ 수검률$/ }] },
  { id: "kosis:accessibility", approved: "장애인편의시설설치현황조사", category: "장애인", tables: [{ id: "DT_117035_2023", rowInclude: / \/ 소계$/, colInclude: /^계 \/ (?:설치율|적정설치율)$/ }] },
  { id: "kosis:sheltered-workshops", approved: "중증장애인생산품생산시설실태조사", category: "장애인", tables: [{ id: "DT_117103_A002", nationalOnly: true }] },
  { id: "kosis:social-expenditure", approved: "한국의 사회복지지출", category: "사회보장", tables: [{ id: "DT_11777_N120" }] },
  { id: "kosis:minimum-cost", approved: "국민생활실태조사", category: "사회보장", tables: [{ id: "DT_117097_N001" }] },
  { id: "kosis:social-services", approved: "사회서비스수요공급실태조사", category: "사회보장", tables: [{ id: "DT_117078_001", rowExclude: /^표준편차/ }] },
  { id: "kosis:homeless", approved: "노숙인등의실태조사", category: "사회보장", tables: [{ id: "DT_117098_2024A001" }] },
  { id: "kosis:older-survey", approved: "노인실태조사", category: "노인", tables: [{ id: "DT_117071_A001", rowExclude: /^시·도 \// }] },
  { id: "kosis:ltc-survey", approved: "장기요양실태조사", category: "노인", tables: [{ id: "DT_117104_A001" }] },
  { id: "kosis:health-centers", approved: "보건소및보건지소운영현황", category: "보건·의료", tables: [{ id: "TX_117191104", nationalOnly: true }] },
  { id: "kosis:cancer", approved: "암등록통계", category: "보건·의료", tables: [{ id: "DT_117N_A00022", rowInclude: / \/ 계$/, colExclude: /상대빈도|조발생률/ }] },
  { id: "kosis:medical-experience", approved: "의료서비스경험조사", category: "보건·의료", tables: [{ id: "DT_117099_A001" }] },
  { id: "kosis:quality", approved: "보건의료질통계", category: "보건·의료", tables: [{ id: "DT_117100_A001" }] },
  { id: "kosis:medical-use", approved: "의료서비스이용현황", category: "보건·의료", tables: [{ id: "DT_117030_001" }] },
  { id: "kosis:mental-health-centers", approved: "국가정신건강현황", category: "보건·의료", tables: [{ id: "DT_920023_A001", nationalOnly: true }] },
  { id: "kosis:mental-health-survey", approved: "정신건강실태조사", category: "보건·의료", tables: [{ id: "DT_117050_A001", colExclude: /RSE/ }] },
  { id: "kosis:health-accounts", approved: "국민보건계정", category: "보건·의료", tables: [{ id: "DT_11768_2009NN4" }] },
  { id: "kosis:medicine-sales", approved: "의약품소비량및판매액통계", category: "보건·의료", tables: [{ id: "DT_11781_N001" }] },
  { id: "kosis:public-hygiene", approved: "공중위생영업소실태보고", category: "보건·의료", tables: [{ id: "TX_117430022", nationalOnly: true }] },
  { id: "kosis:doctors", approved: "보건의료인력실태조사", category: "보건·의료", tables: [{ id: "DT_117110_A002" }] },
  { id: "kosis:organ-donation", approved: "장기등기증및이식통계", category: "보건·의료", tables: [{ id: "DT_117112_001" }] },
];

function clean(text) { return String(text).replace(/\s+/g, " ").trim(); }
function splitUnit(segment) {
  const match = /^(.*\S)\s+\(([^()]+)\)$/.exec(segment);
  return match ? { name: match[1], unit: match[2] } : { name: segment, unit: null };
}
function labelParts(segments) {
  const parts = [];
  let unit = null;
  for (const raw of segments.map(clean).filter(Boolean)) {
    const { name, unit: found } = splitUnit(raw);
    if (found) unit = found;
    if (parts.at(-1) !== name) parts.push(name);
  }
  const named = parts.filter(part => part !== "소계");
  return { parts: named.length ? named : parts, unit };
}
function parseValue(raw) {
  const text = clean(raw);
  if (["", "-", "–", "—", "…", "..."].includes(text)) return { raw: text, value: null, status: "MISSING" };
  if (/^[xX*]$/.test(text)) return { raw: text, value: null, status: "CONFIDENTIAL" };
  const match = /^(-?(?:\d{1,3}(?:,\d{3})+|\d+)(?:\.\d+)?)(\s*[pe]\)?)?$/.exec(text);
  if (!match) throw new Error("Unknown KOSIS value: " + JSON.stringify(text));
  return { raw: text, value: Number(match[1].replace(/,/g, "")), status: !match[2] ? "VALUE" : match[2].includes("e") ? "ESTIMATE" : "PROVISIONAL" };
}
function parsePeriod(raw) {
  const match = /^(\d{4})(?:\s*([pe])\))?$/.exec(clean(raw));
  if (!match) throw new Error("Unknown KOSIS period: " + raw);
  return { period: match[1], marker: match[2] === "p" ? "PROVISIONAL" : match[2] === "e" ? "ESTIMATE" : null };
}
function metadataOf(evidence) {
  const text = evidence.metadata;
  return {
    title: clean(evidence.title || (/^1\) (.+)$/m.exec(text)?.[1] ?? "")),
    statistic: /「([^」]+)」/.exec(text)?.[1] ?? "",
    organization: clean(/「[^」]+」\s*([^\n(]*)/.exec(text)?.[1] ?? ""),
    coverage: clean(/수록기간 : ([^/]+)/.exec(text)?.[1] ?? "") || null,
    updated_at: /자료갱신일: (\d{4}-\d{2}-\d{2})/.exec(text)?.[1] ?? null,
    unit: /\(단위: ([^)]+)\)/.exec(text)?.[1] ?? null,
  };
}

/** Expands KOSIS header spans so every value column knows its period and column labels. */
function readTable(evidence, options) {
  const { head, rows } = evidence.table;
  const grid = head.map(() => []);
  head.forEach((row, r) => {
    let c = 0;
    for (const cell of row) {
      while (grid[r][c]) c++;
      for (let dr = 0; dr < cell.rowspan; dr++) for (let dc = 0; dc < cell.colspan; dc++) (grid[r + dr] ??= [])[c + dc] = cell;
      c += cell.colspan;
    }
  });
  const timeStart = grid[0].findIndex(cell => cell.code === "TIME");
  if (timeStart < 1) throw new Error(evidence.tblId + ": period header not found");
  const valueCount = grid[0].length - timeStart;
  const columns = Array.from({ length: valueCount }, (_, j) => {
    const cells = [...new Set(grid.map(row => row[timeStart + j]).filter(Boolean))];
    const time = cells.find(cell => cell.code === "TIME");
    if (!time) throw new Error(evidence.tblId + ": column without period");
    return { ...parsePeriod(time.text), ...labelParts(cells.filter(cell => cell !== time).map(cell => cell.text)) };
  });
  const observed = [];
  for (const row of rows) {
    const headers = row.filter(cell => cell.kind === "header").map(cell => cell.text);
    const values = row.filter(cell => cell.kind === "value").map(cell => cell.text);
    if (!headers.length) continue;
    if (values.length !== valueCount) throw new Error(evidence.tblId + ": row width " + values.length + " != " + valueCount);
    observed.push({ headers, values });
  }
  const nationalHead = options.nationalOnly ? observed.find(row => NATIONAL.has(clean(row.headers[0])))?.headers[0] : null;
  if (options.nationalOnly && !nationalHead) throw new Error(evidence.tblId + ": national row not found");
  return { columns, rows: observed.filter(row => !nationalHead || row.headers[0] === nationalHead) };
}

function buildDataset(config) {
  const series = new Map();
  const tables = [];
  const periods = new Set();
  let unitFallback = null;
  for (const table of config.tables) {
    const evidence = JSON.parse(readFileSync(new URL(table.id + ".json", EVIDENCE), "utf8"));
    const meta = metadataOf(evidence);
    const { columns, rows } = readTable(evidence, table);
    unitFallback ??= meta.unit;
    tables.push({ org_id: evidence.orgId, tbl_id: evidence.tblId, title: meta.title, statistic: meta.statistic, organization: meta.organization,
      url: "https://kosis.kr/statHtml/statHtml.do?orgId=" + evidence.orgId + "&tblId=" + evidence.tblId,
      updated_at: meta.updated_at, coverage: meta.coverage, checked_at: evidence.checked_at, national_only: Boolean(table.nationalOnly) });
    for (const row of rows) {
      const rowLabel = labelParts(table.nationalOnly ? row.headers.slice(1) : row.headers);
      const rowText = rowLabel.parts.join(" / ");
      if (table.rowInclude && !table.rowInclude.test(row.headers.map(clean).join(" / "))) continue;
      if (table.rowExclude?.test(row.headers.map(clean).join(" / "))) continue;
      row.values.forEach((raw, j) => {
        const column = columns[j];
        const colText = column.parts.join(" / ");
        if (table.colExclude?.test(colText)) return;
        if (table.colInclude && !table.colInclude.test(colText)) return;
        const unit = rowLabel.unit ?? column.unit ?? meta.unit;
        if (!unit) throw new Error(table.id + ": unit missing for " + rowText);
        const base = [rowText, colText].filter(Boolean).join(" / ") || "전체";
        const label = config.tables.length > 1 ? meta.title + " · " + base : base;
        const key = label + "\u0000" + unit;
        if (!series.has(key)) series.set(key, { id: "row-" + (series.size + 1), label, table: tables.length - 1, unit, points: new Map() });
        const point = parseValue(raw);
        periods.add(column.period);
        series.get(key).points.set(column.period, { period: column.period, ...point, status: column.marker && point.status === "VALUE" ? column.marker : point.status });
      });
    }
  }
  const sortedPeriods = [...periods].sort();
  const rows = [...series.values()].map(row => ({ ...row, points: [...row.points.values()].sort((a, b) => a.period.localeCompare(b.period)) }))
    .filter(row => row.points.some(point => point.value !== null));
  rows.forEach((row, index) => { row.id = "row-" + (index + 1); });
  if (!rows.length) throw new Error(config.id + ": no values");
  const checked = tables.map(table => table.checked_at).sort().at(-1);
  const first = tables[0];
  const regional = tables.some(table => table.national_only);
  const latest = sortedPeriods.at(-1);
  const highlight = rows.find(row => row.points.some(point => point.period === latest && point.value !== null)) ?? rows[0];
  return {
    id: config.id, indicator_code: "", table_code: tables.map(table => table.tbl_id).join(", "), category: config.category,
    title: config.approved,
    description: tables.map(table => table.title).join(" · ") + " · KOSIS 공개 통계표 · 수록 " + sortedPeriods[0] + (sortedPeriods.length > 1 ? "~" + sortedPeriods.at(-1) : "") + "년",
    note: "KOSIS 국가통계포털 공개 통계표에서 " + checked.slice(0, 10) + "에 확인한 값입니다. '-'는 자료 없음이며 0을 뜻하지 않습니다." + (regional ? " 이 화면은 전국 합계를 보여주며, 시·도별 값은 KOSIS 원문 표에서 확인할 수 있습니다." : ""),
    highlight_series_id: highlight.id, original_unit: unitFallback ?? "항목별 단위", table_title: tables.map(table => table.title).join(" · "),
    source_url: first.url, indicator_url: first.url,
    source_name: "「" + (first.statistic || config.approved) + "」 " + (first.organization || "보건복지부") + " · KOSIS 국가통계포털",
    source_notes: tables.map(table => table.title + ": 수록기간 " + (table.coverage ?? "원문 참조") + (table.updated_at ? " · 자료갱신일 " + table.updated_at : "")).join(" / ")
      + " · KOSIS 화면에서 최근 10년 범위로 조회한 값입니다.",
    periods: sortedPeriods, series: rows,
    kosis: { approved_title: config.approved, indicator_titles: config.indicators ?? [], checked_at: checked, tables },
  };
}

const datasets = DATASETS.map(buildDataset);
const checkedAt = datasets.map(dataset => dataset.kosis.checked_at).sort().at(-1);
const compact = datasets.map(dataset => ({ ...dataset, series: dataset.series.map(row => ({ id: row.id, label: row.label, unit: row.unit, table: row.table,
  points: row.points.map(point => [point.period, point.raw, point.status]) })) }));
writeFileSync(OUTPUT, "// Generated by scripts/statistics/build-kosis-snapshot.mjs from docs/statistics/kosis/*.json. Do not edit by hand.\n"
  + "import type { KosisSnapshot } from \"./kosis.ts\";\n\n"
  + "export const KOSIS_SNAPSHOT: KosisSnapshot = {\n  checked_at: " + JSON.stringify(checkedAt) + ",\n  datasets: [\n"
  + compact.map(dataset => "    " + JSON.stringify(dataset)).join(",\n") + ",\n  ],\n};\n");
for (const dataset of datasets) console.log(dataset.id, dataset.series.length + " series", dataset.periods.join(","), "|", dataset.series.slice(0, 3).map(row => row.label + " (" + row.unit + ") " + row.points.at(-1).raw).join(" ; "));

