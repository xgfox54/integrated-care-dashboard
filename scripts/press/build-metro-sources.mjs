// 시·도 수집처 확인 기록(metro-sources.mjs)을 마이그레이션으로 만든다.
//   node scripts/press/build-metro-sources.mjs <파일 이름(확장자 제외)>
// 이미 적용된 마이그레이션(0023 등)은 다시 만들지 않는다. 확인 내용이 바뀌면 새 번호로 만들어 덮어쓴다(UPSERT).
// 승인 상태는 덮어쓰지 않는다. 다만 확인 상태가 ENDPOINT_VERIFIED가 아니게 되면 승인을 해제하고 수집을 끈다.
import { existsSync, writeFileSync } from "node:fs";
import { CHECKED_AT, METRO_SOURCES, RECHECKED_AT } from "./metro-sources.mjs";

const name = process.argv[2];
if (!name || !/^\d{4}_[a-z0-9_]+$/.test(name)) throw new Error("마이그레이션 이름(예: 0024_press_metro_recheck)을 주세요.");
const target = new URL("../../drizzle/" + name + ".sql", import.meta.url);
if (existsSync(target)) throw new Error("이미 있는 마이그레이션은 덮어쓰지 않습니다: " + name);
const VERSION = "seed-metro-" + new Date(RECHECKED_AT * 1000).toISOString().slice(0, 10);
const POLICY = "개별 이용조건(공공누리 유형 등)과 공개 표시 권한은 운영자 확인 전이라 승인 대기 상태다.";
const quote = (value) => (value === null ? "NULL" : typeof value === "number" ? String(value) : "'" + String(value).replaceAll("'", "''") + "'");
const COLUMNS = ["source_id", "organization_id", "method", "adapter", "homepage_url", "endpoint_url", "allowed_hosts", "verification_status", "verification_note", "endpoint_verified_at", "policy_basis", "adapter_profile", "registry_version"];
const UPDATED = ["method", "adapter", "homepage_url", "endpoint_url", "allowed_hosts", "verification_status", "verification_note", "endpoint_verified_at", "adapter_profile", "registry_version"];
const lines = ["-- 자동 생성: scripts/press/build-metro-sources.mjs " + name + " (metro-sources.mjs를 고쳐 새 번호로 다시 만든다)"];
for (const source of METRO_SOURCES) {
  const verified = source.verification === "ENDPOINT_VERIFIED";
  const values = [
    "src:" + source.key + ":press", "org:" + source.org, source.method, source.adapter, source.homepage, source.endpoint,
    JSON.stringify(source.hosts), source.verification, source.note, verified ? (source.checkedAt === "recheck" ? RECHECKED_AT : CHECKED_AT) : null,
    POLICY, JSON.stringify(source.profile ?? {}), VERSION,
  ];
  lines.push(
    "INSERT INTO press_source (" + COLUMNS.join(", ") + ") VALUES (" + values.map(quote).join(", ") + ") ON CONFLICT(source_id) DO UPDATE SET " +
      UPDATED.map((column) => column + " = excluded." + column).join(", ") +
      ", approval_status = CASE WHEN excluded.verification_status = 'ENDPOINT_VERIFIED' THEN press_source.approval_status ELSE 'PENDING_PERMISSION' END" +
      ", enabled = CASE WHEN excluded.verification_status = 'ENDPOINT_VERIFIED' THEN press_source.enabled ELSE 0 END;",
    "--> statement-breakpoint",
  );
}
lines.pop();
writeFileSync(target, lines.join("\n") + "\n");
console.log(METRO_SOURCES.length, "sources →", name);
