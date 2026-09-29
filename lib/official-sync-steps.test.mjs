// 단계별 수집: 실제 마이그레이션을 적용한 SQLite와 원문 시드로 요청 여러 번에 걸친 수집을 끝까지 돌려 본다.
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";

import { readMohwSeed } from "./mohw-seed.ts";
import { claimSyncStep, releaseSyncStep, RUN_STALL_SECONDS, STEP_LEASE_SECONDS } from "./official-sync-claim.ts";
import { advanceSyncRun } from "./official-sync-steps.ts";

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

function database() {
  const sqlite = new DatabaseSync(":memory:");
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

  assert.equal(outcomes.at(-1), "succeeded");
  assert.ok(outcomes.length > 20, "수집이 여러 요청으로 나뉘어야 합니다: " + outcomes.length);
  const run = one(db, "SELECT status, service_count, document_count, stage FROM official_sync_run WHERE id = ?", runId);
  assert.deepEqual({ ...run }, { status: "succeeded", service_count: 12526, document_count: 230, stage: "done" });
  assert.equal(one(db, "SELECT COUNT(*) AS n FROM official_service_snapshot WHERE sync_run_id = ?", runId).n, 12526);
  assert.equal(one(db, "SELECT COUNT(*) AS n FROM official_service_snapshot WHERE category = '기타'").n, 807);
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
