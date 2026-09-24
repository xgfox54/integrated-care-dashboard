import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

// 복지제도 대장 색인을 두 파일로 나눈다.
// - index-lite.json: 목록·필터·기본 검색에 필요한 칸(첫 화면에서 받는다)
// - index-extra.json: 담당·법령·구조 지표 등 비교·전체 검색용 칸(뒤이어 받는다)
// 칸 이름을 줄마다 반복하지 않도록 fields 순서의 배열로 담는다.

export const LITE_FIELDS = ["s", "n", "o", "no", "g", "a", "sd", "sg", "c", "t", "l", "h", "pv", "p", "k"];
export const EXTRA_FIELDS = ["s", "d", "y", "cy", "ln", "gw", "lw", "b", "on", "laws"];

export function splitCatalogIndex(index) {
  const pack = (fields) => index.items.map((row) => fields.map((field) => row[field]));
  return {
    lite: { asOf: index.asOf, source: index.source, total: index.total, fields: LITE_FIELDS, items: pack(LITE_FIELDS) },
    extra: { asOf: index.asOf, total: index.total, fields: EXTRA_FIELDS, items: pack(EXTRA_FIELDS) },
  };
}

export function writeSplitIndex(outDir, index) {
  const { lite, extra } = splitCatalogIndex(index);
  const liteJson = JSON.stringify(lite);
  const extraJson = JSON.stringify(extra);
  fs.writeFileSync(path.join(outDir, "index-lite.json"), liteJson);
  fs.writeFileSync(path.join(outDir, "index-extra.json"), extraJson);
  return { liteBytes: Buffer.byteLength(liteJson), extraBytes: Buffer.byteLength(extraJson) };
}

// 단독 실행: 이미 만든 index.json에서 두 파일을 다시 만든다.
if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  const outDir = path.resolve("public/data/welfare100");
  const index = JSON.parse(fs.readFileSync(path.join(outDir, "index.json"), "utf8"));
  console.log(JSON.stringify(writeSplitIndex(outDir, index)));
}
