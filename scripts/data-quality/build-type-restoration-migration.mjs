// data/business-type-restorations.json으로 현재 공개본의 사업구분을 바로 정정하는 D1 마이그레이션을 만든다.
// 실행: node scripts/data-quality/build-type-restoration-migration.mjs drizzle/0127_business_type_source_restoration.sql
import { readFileSync, writeFileSync } from "node:fs";

const output = process.argv[2] ?? "drizzle/0127_business_type_source_restoration.sql";
const restorations = JSON.parse(readFileSync("data/business-type-restorations.json", "utf8"));
const byType = new Map();
for (const [serviceId, entry] of Object.entries(restorations.rows)) {
  if (!/^\d{4}:\d+:\d+:\d+:[0-9A-Za-z-]+$/.test(serviceId)) throw new Error("unexpected service id " + serviceId);
  if (!byType.has(entry.type)) byType.set(entry.type, []);
  byType.get(entry.type).push(serviceId);
}
const quote = (value) => "'" + value.replace(/'/g, "''") + "'";
const statements = [...byType].map(([type, ids]) => "UPDATE official_service_snapshot SET type = " + quote(type) + " WHERE type = '미분류' AND service_id IN (" + ids.map(quote).join(", ") + ");");
statements.push("DELETE FROM dataset_response_cache;");
const header = [
  "-- " + restorations.revision + ": 사업구분 원문 대조 정정(docs/data-quality/business-type-review-20261014.json).",
  "-- 원문 '구분' 칸 표기와 시드 파서 기록값이 일치한 " + Object.keys(restorations.rows).length + "건만 바꾼다. 되돌리기: 같은 service_id의 type을 '미분류'로 되돌린다.",
].join("\n");
writeFileSync(output, header + "\n" + statements.join("\n--> statement-breakpoint\n") + "\n");
console.log(output, [...byType].map(([type, ids]) => type + ":" + ids.length).join(" "));

