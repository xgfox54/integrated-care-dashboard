import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtempSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import test from "node:test";
import { businessDatabase, restorationFixture } from "./business-data-test-support.mjs";
import { expandCompactRows } from "./dataset.ts";
import { insertServicesStatement } from "./official-sync-writes.ts";

const script = fileURLToPath(new URL("../scripts/build-dashboard-snapshot.mjs", import.meta.url));
const rows = restorationFixture.map(({ live }) => ({ ...live }));
while (rows.length < 12526) rows.push({ ...rows[0], serviceId: `synthetic:${rows.length}`, name: `fixture ${rows.length}` });
const ids = ["0085:1489600:1:2:7", "0085:1489600:1:2:11"];
const descriptions = ["사람이 확인하여 편집한 설명 보존", ""];
async function runFixture(name, callback) {
  const root = process.env.BUSINESS_EVIDENCE_DIR ? resolve(process.env.BUSINESS_EVIDENCE_DIR) : tmpdir();
  mkdirSync(root, { recursive: true });
  const cwd = mkdtempSync(resolve(root, name + "-"));
  try { await callback(cwd); } finally { if (!process.env.BUSINESS_EVIDENCE_DIR) rmSync(cwd, { recursive: true, force: true }); }
}
function build(cwd, source) {
  const result = spawnSync(process.execPath, ["--experimental-strip-types", script], { cwd, env: { ...process.env, DASHBOARD_SNAPSHOT_SOURCE: source ?? "" }, encoding: "utf8", timeout: 60_000 });
  writeFileSync(resolve(cwd, "build.log"), `exit=${result.status}\n${result.stdout}\n${result.stderr}`);
  assert.equal(result.status, 0, result.stderr);
  const dir = resolve(cwd, "public/data/regions");
  const actual = readdirSync(dir).flatMap((name) => expandCompactRows(JSON.parse(readFileSync(resolve(dir, name), "utf8"))));
  assert.equal(actual.length, 12526);
  for (const { live, expected } of restorationFixture) {
    const row = actual.find((candidate) => candidate.serviceId === live.serviceId);
    assert.equal(row.subcategory, expected.subcategory, live.serviceId);
    assert.equal(row.type, expected.type, live.serviceId);
  }
  for (const [i, id] of ids.entries()) {
    const row = actual.find((candidate) => candidate.serviceId === id);
    assert.equal(row.description, descriptions[i], id);
    assert.equal(row.target, "편집 대상");
    assert.equal(row.provider, "편집 기관");
    assert.equal(row.applicationMethod, "편집 신청방법");
  }
}

test("explicit public response keeps edited descriptions (including empty) while restoring only structural fields", () => runFixture("public", (cwd) => {
  const services = rows.map((row) => ids.includes(row.serviceId) ? { ...row, description: descriptions[ids.indexOf(row.serviceId)], target: "편집 대상", provider: "편집 기관", applicationMethod: "편집 신청방법" } : row);
  const source = resolve(cwd, "public-input.json");
  writeFileSync(source, JSON.stringify({ rows: services, fetchedAt: "2026-10-05T06:44:12.000Z", dataAsOf: "2026-07" }));
  const before = readFileSync(source);
  build(cwd, source);
  assert.deepEqual(readFileSync(source), before);
}));

test("local DB snapshot applies wiki_edit after semantic correction and leaves DB bytes unchanged", () => runFixture("database", async (cwd) => {
  const state = resolve(cwd, ".wrangler/state");
  mkdirSync(state, { recursive: true });
  const path = resolve(state, "fixture.sqlite");
  const db = businessDatabase(path);
  try {
    for (const statement of insertServicesStatement(db, "fixture", rows, 0, 1791182652)) await statement.run();
    for (const [i, id] of ids.entries()) db.sqlite.prepare("INSERT INTO wiki_edit (service_id, sido, sigungu, name, description, target, provider, application_method, updated_at) VALUES (?, '경기도', '김포시', '일상돌봄', ?, '편집 대상', '편집 기관', '편집 신청방법', 1791182652)").run(id, descriptions[i]);
  } finally {
    db.sqlite.close();
  }
  const hash = () => createHash("sha256").update(readFileSync(path)).digest("hex");
  const before = hash();
  build(cwd);
  assert.equal(hash(), before);
}));
