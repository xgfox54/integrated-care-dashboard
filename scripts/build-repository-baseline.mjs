import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";

const INPUT_PATH = resolve("../work/services_national.json");
const OUTPUT_PATH = resolve("data/repository-baseline.json");

function text(row, key) {
  return String(row[key] ?? "").trim().replace(/수\s+행/g, "수행");
}

function identityPart(value) {
  return value.toLowerCase().replace(/[^0-9가-힣a-z]/g, "");
}

function identity(row) {
  return [row.시도, row.시군구, row.사업명].map((value) => identityPart(String(value ?? ""))).join("|");
}

const rows = JSON.parse(await readFile(INPUT_PATH, "utf8"));
const identityCounts = new Map();
for (const row of rows) {
  const key = identity(row);
  identityCounts.set(key, (identityCounts.get(key) ?? 0) + 1);
}
const services = rows
  .filter((row) => identityCounts.get(identity(row)) === 1)
  .map((row, index) => ({
    serviceId: `repository:${index}`,
    sido: text(row, "시도"),
    sigungu: text(row, "시군구"),
    category: text(row, "대분류"),
    subcategory: text(row, "중분류"),
    name: text(row, "사업명"),
    description: text(row, "사업내용"),
    target: text(row, "지원대상"),
    detailTarget: "",
    provider: text(row, "제공기관"),
    type: text(row, "사업구분"),
    serial: "",
    detailUrl: "",
    updatedDate: "",
  }));
const ambiguousIdentityCount = [...identityCounts.values()].filter((count) => count > 1).length;
const output = { sourceCount: rows.length, ambiguousIdentityCount, services };

await mkdir(dirname(OUTPUT_PATH), { recursive: true });
await writeFile(OUTPUT_PATH, JSON.stringify(output), "utf8");
console.log(JSON.stringify({
  sourceCount: output.sourceCount,
  correctionCount: services.length,
  ambiguousIdentityCount,
}));
