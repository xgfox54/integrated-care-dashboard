import JSZip from "jszip";

import type { FilterState, ServiceRow } from "./dataset.ts";
import { csvFileName, DATASET_EXPORT_COLUMNS } from "./dataset-csv.ts";

const SHEET_NAME = "검색결과";
const COLUMN_WIDTHS = [16, 18, 20, 20, 36, 80, 48, 36, 32, 16];
const MAIN_NS = "http://schemas.openxmlformats.org/spreadsheetml/2006/main";
const REL_NS = "http://schemas.openxmlformats.org/officeDocument/2006/relationships";
const PKG_REL_NS = "http://schemas.openxmlformats.org/package/2006/relationships";
const XML_HEAD = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n';

const xmlText = (value: string) => value
  .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\uFFFE\uFFFF]/g, "")
  .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const columnName = (index: number) => String.fromCharCode(65 + index);

// 모든 칸을 inline 문자열로 쓴다. 숫자·수식처럼 보이는 원문(00123, =1+1)도 글자 그대로 남는다.
function sheetXml(values: readonly (readonly string[])[]): string {
  const lastColumn = columnName(DATASET_EXPORT_COLUMNS.length - 1);
  const cols = COLUMN_WIDTHS.map((width, index) => '<col min="' + (index + 1) + '" max="' + (index + 1) + '" width="' + width + '" customWidth="1"/>').join("");
  const rows = values.map((cells, rowIndex) => '<row r="' + (rowIndex + 1) + '">' + cells.map((cell, columnIndex) =>
    '<c r="' + columnName(columnIndex) + (rowIndex + 1) + '" t="inlineStr"><is><t xml:space="preserve">' + xmlText(cell) + "</t></is></c>").join("") + "</row>").join("");
  return XML_HEAD + '<worksheet xmlns="' + MAIN_NS + '"><cols>' + cols + "</cols><sheetData>" + rows + '</sheetData><autoFilter ref="A1:' + lastColumn + values.length + '"/></worksheet>';
}

export async function toXlsx(rows: readonly ServiceRow[]): Promise<ArrayBuffer> {
  const values = [
    DATASET_EXPORT_COLUMNS.map(([label]) => label),
    ...rows.map((row) => DATASET_EXPORT_COLUMNS.map(([, field]) => String(row[field] ?? ""))),
  ];
  const lastColumn = columnName(DATASET_EXPORT_COLUMNS.length - 1);
  const zip = new JSZip();
  zip.file("[Content_Types].xml", XML_HEAD + '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/></Types>');
  zip.file("_rels/.rels", XML_HEAD + '<Relationships xmlns="' + PKG_REL_NS + '"><Relationship Id="rId1" Type="' + REL_NS + '/officeDocument" Target="xl/workbook.xml"/></Relationships>');
  zip.file("xl/workbook.xml", XML_HEAD + '<workbook xmlns="' + MAIN_NS + '" xmlns:r="' + REL_NS + '"><sheets><sheet name="' + SHEET_NAME + '" sheetId="1" r:id="rId1"/></sheets><definedNames><definedName name="_xlnm._FilterDatabase" localSheetId="0" hidden="1">\'' + SHEET_NAME + "'!$A$1:$" + lastColumn + "$" + values.length + "</definedName></definedNames></workbook>");
  zip.file("xl/_rels/workbook.xml.rels", XML_HEAD + '<Relationships xmlns="' + PKG_REL_NS + '"><Relationship Id="rId1" Type="' + REL_NS + '/worksheet" Target="worksheets/sheet1.xml"/><Relationship Id="rId2" Type="' + REL_NS + '/styles" Target="styles.xml"/></Relationships>');
  zip.file("xl/styles.xml", XML_HEAD + '<styleSheet xmlns="' + MAIN_NS + '"><fonts count="1"><font><sz val="11"/><name val="맑은 고딕"/></font></fonts><fills count="2"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill></fills><borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders><cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs><cellXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/></cellXfs><cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles></styleSheet>');
  zip.file("xl/worksheets/sheet1.xml", sheetXml(values));
  return zip.generateAsync({ type: "arraybuffer", compression: "DEFLATE", compressionOptions: { level: 6 } });
}

export function xlsxFileName(filters: FilterState, today: Date): string {
  return csvFileName(filters, today).replace(/\.csv$/, ".xlsx");
}

