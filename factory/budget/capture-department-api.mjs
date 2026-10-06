import { writeFileSync } from "node:fs";

const [output] = process.argv.slice(2);
if (!output) throw Error("OUTPUT_REQUIRED");
const base = "https://integrated-care-national-dashboard.xgfox54.chatgpt.site/api/budget";
async function page(number) {
  const url = base + "?" + new URLSearchParams({ mode: "department", entity: "lofin:laf:4900000", view: "main", page: String(number) });
  const response = await fetch(url, { signal: AbortSignal.timeout(60000) });
  if (!response.ok) throw Error("HTTP_" + response.status);
  const data = await response.json();
  if (!data.snapshot?.complete || !Array.isArray(data.items)) throw Error("INCOMPLETE_PUBLIC_SNAPSHOT");
  return { url, data };
}
const first = await page(1), results = [first];
const count = Math.ceil(first.data.total / first.data.size);
for (let start = 2; start <= count; start += 6) {
  results.push(...await Promise.all(Array.from({ length: Math.min(6, count - start + 1) }, (_, i) => page(start + i))));
  console.log(JSON.stringify({ pages_complete: results.length, pages_total: count }));
}
if (results.some(({ data }) => data.total !== first.data.total || data.snapshot.snapshot_id !== first.data.snapshot.snapshot_id)) throw Error("SNAPSHOT_CHANGED");
const items = results.flatMap(({ data }) => data.items);
if (items.length !== first.data.total || new Set(items.map((r) => r.fiscal_project_id)).size !== items.length) throw Error("PAGINATION_MISMATCH");
writeFileSync(output, JSON.stringify({ pages: results.map(({ url, data }) => ({ url, total: data.total, size: data.size, snapshot: data.snapshot })), items }, null, 2));
console.log(JSON.stringify({ complete: true, rows: items.length }));
