import { backupFetch } from './backup-fetch.mjs';
// 공개 운영 데이터 백업(작업지시서 2026-10-14 §4-2). 운영 사이트의 공개 API에서 사업·복지제도100·자료 상태·MCP 공개본 식별정보를 받아
// 운영환경 밖 폴더에 저장하고 파일별 SHA-256 목록(manifest.json)을 남긴다. 관리자 비공개 자료와 인증키는 받지 않는다.
// 실행: node scripts/ops/backup-public-data.mjs [--site https://...] [--dir ../backups]   검증: node scripts/ops/backup-public-data.mjs --verify <백업폴더>
import { inspectPublicBackup } from "./backup-integrity.mjs";
import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const args = process.argv.slice(2);
const option = (name, fallback) => (args.includes(name) ? args[args.indexOf(name) + 1] : fallback);
const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");

if (args.includes("--verify")) {
  const dir = option("--verify", "");
  const result = inspectPublicBackup(dir);
  console.log(JSON.stringify({ dir, integrity: result.integrity, errors: result.errors }, null, 1));
  process.exit(result.errors.length ? 1 : 0);
}

const site = option("--site", "https://integrated-care-national-dashboard.xgfox54.chatgpt.site").replace(/\/$/, "");
const stamp = new Date().toISOString().replace(/[:.]/g, "-");
const dir = join(option("--dir", "../backups"), "public-data-" + stamp);
mkdirSync(dir, { recursive: true });
const targets = [
  ["services.csv", "/api/dataset/export"],
  ["services.json", "/api/dataset?refresh=1"],
  ["statistics-status.json", "/api/statistics?view=status"],
  ["dataset-summary.json", "/api/dataset/summary"],
  ["data-status.json", "/api/data-status"],
  ["welfare100-index.json", "/data/welfare100/index.json"],
  ["press-status.json", "/api/press/status"],
  ["regional-institutions.json", "/api/regional-indicators/institutions"],
];
const files = [];
for (const [name, path] of targets) {
  const response = await backupFetch(site + path, { timeoutMs: 60000, headers: { "user-agent": "integrated-care-backup/1.0" } });
  if (!response.ok) { files.push({ name, source: site + path, status: response.status, sha256: null, bytes: 0 }); continue; }
  const bytes = Buffer.from(await response.arrayBuffer());
  writeFileSync(join(dir, name), bytes);
  files.push({ name, source: site + path, status: response.status, sha256: sha256(bytes), bytes: bytes.length });
}
const statisticsStatus = JSON.parse(readFileSync(join(dir, "statistics-status.json"), "utf8")).status;
const statistics = [];
for (const dataset of statisticsStatus.datasets) {
 const response = await backupFetch(site + "/api/statistics?id=" + encodeURIComponent(dataset.id), { timeoutMs: 30000 });
 let data = await response.json();
 if (response.status === 404) {
  const mcp = await backupFetch(site + "/claude/mcp", { method: "POST", headers: { "content-type": "application/json", accept: "application/json, text/event-stream" }, timeoutMs: 30000, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: "get_statistics_data", arguments: { statistics_id: dataset.id } } }) });
  const text = await mcp.text(); const line = text.split("\n").find(value => value.startsWith("data:"));
  const result = JSON.parse(line ? line.slice(5) : text).result;
  const envelope = result?.structuredContent ?? JSON.parse(result?.content?.find(value => value.type === "text")?.text ?? "{}");
  data = { ok: Boolean(envelope.data?.dataset), ...envelope.data };
 }
 if (!data.ok || data.dataset?.id !== dataset.id) throw new Error("통계 백업 실패: " + dataset.id);
 statistics.push(data);
}
const statsBytes = Buffer.from(JSON.stringify(statistics));
writeFileSync(join(dir,"statistics.json"),statsBytes);
files.push({name:"statistics.json",source:site+"/api/statistics",status:200,sha256:sha256(statsBytes),bytes:statsBytes.length});
const mcpUrl = site + "/claude/mcp";
const mcpHeaders = { "content-type": "application/json", accept: "application/json, text/event-stream" };
const init = await backupFetch(mcpUrl, { method: "POST", headers: mcpHeaders, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "backup", version: "1" } } }) });
const session = init.headers.get("mcp-session-id");
const statusResponse = await backupFetch(mcpUrl, { method: "POST", headers: session ? { ...mcpHeaders, "mcp-session-id": session } : mcpHeaders, body: JSON.stringify({ jsonrpc: "2.0", id: 2, method: "tools/call", params: { name: "get_dataset_status", arguments: {} } }) });
const statusText = await statusResponse.text();
const statusLine = statusText.split("\n").find((line) => line.startsWith("data:"));
const statusBytes = Buffer.from(statusLine ? statusLine.slice(5) : statusText);
writeFileSync(join(dir, "mcp-dataset-status.json"), statusBytes);
files.push({ name: "mcp-dataset-status.json", source: mcpUrl + " get_dataset_status", status: statusResponse.status, sha256: sha256(statusBytes), bytes: statusBytes.length });
const summary = JSON.parse(readFileSync(join(dir, "dataset-summary.json"), "utf8"));
const mcp = JSON.parse(statusBytes.toString("utf8"));
const release = mcp.result?.structuredContent ?? JSON.parse(mcp.result?.content?.[0]?.text ?? "{}");
const manifest = {
  created_at: new Date().toISOString(), site, kind: "public-data", release_bundle_id: release.release_bundle_id ?? null, components: release.components ?? null,
  service_total: summary.summary?.totalCount ?? null, data_as_of: summary.dataAsOf ?? null, fetched_at: summary.fetchedAt ?? null,
  excluded: "관리자 인증이 필요한 자료(인증키·세션·관리자 설정·비공개 반입본)는 포함하지 않습니다.", files,
};
writeFileSync(join(dir, "manifest.json"), JSON.stringify(manifest, null, 1) + "\n");
const integrity = inspectPublicBackup(dir);
console.log(JSON.stringify({ dir, integrity: integrity.integrity, errors: integrity.errors, files: files.length, failed: files.filter((file) => !file.sha256).map((file) => file.name), release_bundle_id: manifest.release_bundle_id, service_total: manifest.service_total }, null, 1));


if (integrity.errors.length) process.exitCode = 1;
