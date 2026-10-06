// 단계별 수집: 실제 마이그레이션을 적용한 SQLite와 원문 시드로 요청 여러 번에 걸친 수집을 끝까지 돌려 본다.
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import test, { afterEach } from "node:test";

import { readMohwSeed } from "./mohw-seed.ts";
import { claimSyncStep, releaseSyncStep, RUN_STALL_SECONDS, STEP_LEASE_SECONDS } from "./official-sync-claim.ts";
import { advanceSyncRun } from "./official-sync-steps.ts";
import { PUBLIC_KNOWLEDGE_RUN_SQL } from "./platform/public-pin.ts";

class Statement {
  constructor(db, sql, values = []) {
    this.db = db;
    this.sql = sql;
    this.values = values;
  }
  bind(...values) {
    return new Statement(this.db, this.sql, values);
  }
  async first() {
    return this.db.prepare(this.sql).get(...this.values) ?? null;
  }
  async all() {
    return { results: this.db.prepare(this.sql).all(...this.values) };
  }
  async run() {
    return this.db.prepare(this.sql).run(...this.values);
  }
}

const openDatabases = new Set();
afterEach(() => {
  for (const sqlite of openDatabases) sqlite.close();
  openDatabases.clear();
});

function database() {
  const sqlite = new DatabaseSync(":memory:");
  openDatabases.add(sqlite);
  const dir = new URL("../drizzle/", import.meta.url);
  for (const file of readdirSync(dir).filter((name) => name.endsWith(".sql")).sort()) {
    for (const statement of readFileSync(new URL(file, dir), "utf8").split("--> statement-breakpoint")) {
      if (statement.trim()) sqlite.exec(statement);
    }
  }
  return {
    sqlite,
    prepare: (sql) => new Statement(sqlite, sql),
    async batch(statements) {
      sqlite.exec("BEGIN");
      try {
        const results = statements.map((statement) => sqlite.prepare(statement.sql).run(...statement.values));
        sqlite.exec("COMMIT");
        return results;
      } catch (error) {
        sqlite.exec("ROLLBACK");
        throw error;
      }
    },
  };
}

const seed = readMohwSeed();
const NOW = 1_800_000_000;

function fakeSources(overrides = {}) {
  const calls = { reads: [], apiPages: 0 };
  return {
    calls,
    listProvinceDocuments: async (province) => seed.documents.filter((entry) => entry.document.province === province).map((entry) => entry.document),
    readDocumentServices: async (document) => {
      calls.reads.push(document.documentId);
      return seed.documents.find((entry) => entry.document.documentId === document.documentId)?.services ?? [];
    },
    readApiPage: async () => {
      calls.apiPages += 1;
      return { kind: "unavailable", reason: "인증키가 등록되지 않았습니다." };
    },
    ...overrides,
  };
}

let sequence = 0;
async function step(db, sources, now = NOW, trigger = "automatic", stale = true) {
  sequence += 1;
  const claim = await claimSyncStep(db, { trigger, stale, now, lease: "lease-" + sequence, newRunId: "run-" + sequence });
  if (!claim) return { outcome: "none" };
  try {
    return { outcome: await advanceSyncRun(db, sources, claim.runId, { deadline: 0, nowMs: () => now * 1000 }), runId: claim.runId };
  } finally {
    await releaseSyncStep(db, claim.lease);
  }
}

async function runToEnd(db, sources, limit = 400) {
  const outcomes = [];
  for (let index = 0; index < limit; index += 1) {
    const result = await step(db, sources);
    outcomes.push(result.outcome);
    if (result.outcome !== "continuing") return { outcomes, runId: result.runId };
  }
  throw new Error("수집이 끝나지 않았습니다.");
}

const one = (db, sql, ...values) => db.sqlite.prepare(sql).get(...values);

test("Given stale data When requests advance the sync one unit at a time Then the whole dataset is collected and promoted", async () => {
  const db = database();
  const { outcomes, runId } = await runToEnd(db, fakeSources());

  assert.equal(outcomes.at(-1), "succeeded", one(db, "SELECT error FROM official_sync_run WHERE id = ?", runId)?.error);
  assert.ok(outcomes.length > 20, "수집이 여러 요청으로 나뉘어야 합니다: " + outcomes.length);
  const run = one(db, "SELECT status, service_count, document_count, stage FROM official_sync_run WHERE id = ?", runId);
  assert.deepEqual({ ...run }, { status: "succeeded", service_count: 12526, document_count: 230, stage: "done" });
  assert.equal(one(db, "SELECT COUNT(*) AS n FROM official_service_snapshot WHERE sync_run_id = ?", runId).n, 12526);
  assert.equal(one(db, "SELECT COUNT(*) AS n FROM official_service_snapshot WHERE category = '기타'").n, 807);
  for (const { live, expected } of JSON.parse(readFileSync(new URL("./fixtures/mohw/source-restoration.json", import.meta.url), "utf8"))) {
    const stored = one(db, "SELECT subcategory, type FROM official_service_snapshot WHERE sync_run_id = ? AND service_id = ?", runId, live.serviceId);
    assert.deepEqual({ ...stored }, { subcategory: expected.subcategory, type: expected.type }, live.serviceId);
  }
  assert.equal(one(db, "SELECT COUNT(*) AS n FROM official_sync_lock").n, 0);
  assert.equal(one(db, "SELECT COUNT(*) AS n FROM official_sync_api_page").n, 0);
});

test("Given a transient network failure When the same unit fails twice Then the next request retries and the sync still succeeds", async () => {
  const db = database();
  let failures = 2;
  const sources = fakeSources({
    listProvinceDocuments: async (province) => {
      if (province === "대구광역시" && failures > 0) {
        failures -= 1;
        throw new Error("The operation was aborted due to timeout");
      }
      return seed.documents.filter((entry) => entry.document.province === province).map((entry) => entry.document);
    },
  });
  const { outcomes } = await runToEnd(db, sources);
  assert.equal(outcomes.at(-1), "succeeded");
});

test("Given a unit that keeps failing When it fails three times in a row Then the run fails and its partial rows are removed", async () => {
  const db = database();
  const sources = fakeSources({ listProvinceDocuments: async () => { throw new Error("HTTP 503"); } });
  const { outcomes, runId } = await runToEnd(db, sources);

  assert.deepEqual(outcomes, ["continuing", "continuing", "failed"]);
  assert.equal(one(db, "SELECT error FROM official_sync_run WHERE id = ?", runId).error, "HTTP 503");
  assert.equal(one(db, "SELECT COUNT(*) AS n FROM official_source_document").n, 0);
  assert.equal(one(db, "SELECT COUNT(*) AS n FROM official_sync_lock").n, 0);
});

test("Given a republished document When the sync reaches it Then only that document is read and cached", async () => {
  const db = database();
  const changedId = seed.documents[5].document.documentId;
  const base = fakeSources();
  const sources = {
    ...base,
    listProvinceDocuments: async (province) => (await base.listProvinceDocuments(province)).map((document) =>
      document.documentId === changedId ? { ...document, publishedAt: "2026-10-01" } : document),
  };
  const { outcomes } = await runToEnd(db, sources);

  assert.equal(outcomes.at(-1), "succeeded");
  assert.deepEqual(base.calls.reads, [changedId]);
  assert.equal(one(db, "SELECT COUNT(*) AS n FROM official_document_service_cache WHERE document_id = ?", changedId).n, 1);
});

test("Given an available public API When every term has two pages Then each page is its own unit and the pages are cleaned up", async () => {
  const db = database();
  const sources = fakeSources({ readApiPage: async () => ({ kind: "page", totalCount: 150, services: [] }) });
  let pages = 0;
  const counted = { ...sources, readApiPage: async (term, page) => { pages += 1; return sources.readApiPage(term, page); } };
  const { outcomes } = await runToEnd(db, counted);

  assert.equal(outcomes.at(-1), "succeeded");
  assert.equal(pages, 30);
  assert.equal(one(db, "SELECT COUNT(*) AS n FROM official_sync_api_page").n, 0);
});

test("Given a previous snapshot When a new sync succeeds Then only the new run's rows remain", async () => {
  const db = database();
  const first = await runToEnd(db, fakeSources());
  db.sqlite.prepare("UPDATE official_sync_run SET completed_at = ? WHERE id = ?").run(NOW - 2 * 86400, first.runId);
  const second = await runToEnd(db, fakeSources());

  assert.notEqual(first.runId, second.runId);
  assert.deepEqual(db.sqlite.prepare("SELECT DISTINCT sync_run_id AS id FROM official_service_snapshot").all().map((row) => row.id), [second.runId]);
});

test("Given fresh data When a visitor request checks Then no run starts and the lease is released", async () => {
  const db = database();
  const result = await step(db, fakeSources(), NOW, "automatic", false);
  assert.equal(result.outcome, "none");
  assert.equal(one(db, "SELECT COUNT(*) AS n FROM official_sync_run").n, 0);
  assert.equal(one(db, "SELECT COUNT(*) AS n FROM official_sync_lock").n, 0);
});

test("Given a held lease When another request claims Then it waits until the lease expires and then continues the same run", async () => {
  const db = database();
  const first = await claimSyncStep(db, { trigger: "automatic", stale: true, now: NOW, lease: "a", newRunId: "run-a" });
  const blocked = await claimSyncStep(db, { trigger: "automatic", stale: true, now: NOW + 10, lease: "b", newRunId: "run-b" });
  const later = await claimSyncStep(db, { trigger: "automatic", stale: true, now: NOW + STEP_LEASE_SECONDS + 1, lease: "c", newRunId: "run-c" });

  assert.deepEqual(first, { runId: "run-a", lease: "a" });
  assert.equal(blocked, null);
  assert.deepEqual(later, { runId: "run-a", lease: "c" });
});

test("Given a run that stopped advancing for hours When a request claims Then it is closed and a new run starts", async () => {
  const db = database();
  await claimSyncStep(db, { trigger: "automatic", stale: true, now: NOW, lease: "a", newRunId: "run-old" });
  const claim = await claimSyncStep(db, { trigger: "automatic", stale: true, now: NOW + RUN_STALL_SECONDS + 1, lease: "b", newRunId: "run-new" });

  assert.deepEqual(claim, { runId: "run-new", lease: "b" });
  assert.equal(one(db, "SELECT status FROM official_sync_run WHERE id = 'run-old'").status, "failed");
});


test("Given a full sync When it is promoted Then every extracted source row is accounted for as mapped, unresolved, or excluded with a reason", async () => {
  const { ledgerTotals } = await import("./official-ledger.ts");
  const db = database();
  const { runId } = await runToEnd(db, fakeSources());
  const rows = db.sqlite.prepare("SELECT document_id, extracted, mapped, preserved_unresolved, excluded_unparseable, excluded_fragment, traced FROM official_source_row_ledger WHERE run_id = ?").all(runId);
  const totals = ledgerTotals(rows);
  assert.equal(totals.documents, 230, "문서마다 원장 한 행");
  assert.equal(totals.balanced, true, JSON.stringify(totals.unbalanced_documents));
  assert.equal(totals.mapped + totals.preserved_unresolved, 12526, "저장 행 수와 같다");
  assert.equal(totals.evidence_traceability.rate, 100, "모든 저장 행이 자기 원문 문서로 이어진다");
  console.log("ledger", JSON.stringify({ ...totals, unbalanced_documents: totals.unbalanced_documents.length, denominator_note: undefined }));
});


test("Given an active release bundle on the previous run When a new sync succeeds Then that run stays readable until the bundle moves and the next sync prunes it", async () => {
  const db = database();
  const activate = (runId) => {
    db.sqlite.prepare(
      "INSERT OR REPLACE INTO platform_release_bundle (bundle_id, bundle_schema_version, components_key, knowledge_snapshot_id, fiscal_snapshot_id, news_snapshot_id, link_snapshot_id, components_json, compatibility_report, status, created_at) VALUES (?, '1.0', ?, ?, NULL, NULL, NULL, '{}', '{}', 'active', ?)",
    ).run("rb_" + runId, runId, "kg:" + runId, NOW);
    db.sqlite.prepare("UPDATE platform_active_bundle SET bundle_id = ?, revision = revision + 1 WHERE id = 1").run("rb_" + runId);
  };
  const publicRun = () => db.sqlite.prepare("SELECT " + PUBLIC_KNOWLEDGE_RUN_SQL + " AS id").get().id;
  const runs = () => db.sqlite.prepare("SELECT DISTINCT sync_run_id AS id FROM official_service_snapshot ORDER BY id").all().map((row) => row.id).sort();
  const first = await runToEnd(db, fakeSources());
  activate(first.runId);
  db.sqlite.prepare("UPDATE official_sync_run SET completed_at = ? WHERE id = ?").run(NOW - 2 * 86400, first.runId);
  const second = await runToEnd(db, fakeSources());
  assert.deepEqual(runs(), [first.runId, second.runId].sort(), "공개본이 아직 가리키는 이전 실행은 남는다");
  assert.equal(publicRun(), first.runId, "웹도 공개본의 실행을 읽는다(MCP와 같은 릴리스)");
  activate(second.runId);
  assert.equal(publicRun(), second.runId);
  db.sqlite.prepare("UPDATE official_sync_run SET completed_at = ? WHERE id = ?").run(NOW - 2 * 86400, second.runId);
  const third = await runToEnd(db, fakeSources());
  assert.deepEqual(runs(), [second.runId, third.runId].sort(), "공개본에서 벗어난 실행은 다음 수집 때 정리된다");
  db.sqlite.prepare("UPDATE platform_active_bundle SET bundle_id = NULL WHERE id = 1").run();
  assert.equal(publicRun(), third.runId, "공개본이 없으면 최근 성공 실행");
});

test("Given a previous run When a new sync drops one service and changes another Then the presence ledger records missing (not ended) and revised against the baseline", async () => {
  const db = database();
  const first = await runToEnd(db, fakeSources());
  const baseline = one(db, "SELECT * FROM service_presence_run WHERE run_id = ?", first.runId);
  assert.equal(baseline.previous_run_id, null, "첫 기록은 기준선");
  assert.equal(baseline.missing_count, 0);
  assert.equal(baseline.listed, one(db, "SELECT COUNT(*) AS n FROM service_presence").n);
  db.sqlite.prepare("UPDATE official_sync_run SET completed_at = ? WHERE id = ?").run(NOW - 2 * 86400, first.runId);
  const target = seed.documents.find((entry) => entry.services.length >= 3);
  const [dropped, changed] = target.services;
  const base = fakeSources();
  const sources = {
    ...base,
    listProvinceDocuments: async (province) => (await base.listProvinceDocuments(province)).map((document) =>
      document.documentId === target.document.documentId ? { ...document, publishedAt: "2026-10-01" } : document),
    readDocumentServices: async (document) => document.documentId === target.document.documentId
      ? target.services.slice(1).map((service) => service.serviceId === changed.serviceId ? { ...service, description: service.description + " (내용 변경)" } : service)
      : base.readDocumentServices(document),
  };
  const second = await runToEnd(db, sources);
  const summary = one(db, "SELECT * FROM service_presence_run WHERE run_id = ?", second.runId);
  assert.equal(summary.previous_run_id, first.runId);
  assert.equal(summary.new_count, 0);
  assert.equal(summary.revised_count, 1);
  assert.equal(summary.missing_count, 1);
  const missing = one(db, "SELECT * FROM service_presence WHERE status = 'MISSING_FROM_LATEST_SOURCE'");
  assert.equal(missing.name, dropped.name);
  assert.equal(missing.last_seen_run, first.runId, "마지막으로 본 실행을 남기고 종료일은 만들지 않는다");
  assert.ok(missing.missing_since);
  const revised = one(db, "SELECT * FROM service_presence WHERE revised_run = ?", second.runId);
  assert.equal(revised.name, changed.name);
  assert.equal(revised.status, "LISTED");
});
