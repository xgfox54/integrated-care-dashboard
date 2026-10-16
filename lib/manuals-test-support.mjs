import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { advanceManualCorpus } from "./manuals/store.ts";

export const sha256 = (value) => createHash("sha256").update(value).digest("hex");
export const NOW = 1_791_600_000;

export function manualDatabase() {
  const sqlite = new DatabaseSync(":memory:");
  sqlite.exec("PRAGMA foreign_keys=ON");
  sqlite.exec(readFileSync(new URL("../drizzle/0110_manual_corpus.sql", import.meta.url), "utf8"));
  const boundCounts = [];
  class Statement {
    constructor(sql, values = []) { this.sql = sql; this.values = values; }
    bind(...values) {
      boundCounts.push(values.length);
      assert.ok(values.length <= 100, `D1 bind ceiling exceeded: ${values.length}`);
      return new Statement(this.sql, values);
    }
    async first() { return sqlite.prepare(this.sql).get(...this.values) ?? null; }
    async all() { return { results: sqlite.prepare(this.sql).all(...this.values) }; }
    async run() { return sqlite.prepare(this.sql).run(...this.values); }
  }
  return {
    sqlite, boundCounts, prepare: (sql) => new Statement(sql),
    async batch(statements) {
      sqlite.exec("BEGIN");
      try {
        const result = statements.map((statement) => sqlite.prepare(statement.sql).run(...statement.values));
        sqlite.exec("COMMIT");
        return result;
      } catch (error) { sqlite.exec("ROLLBACK"); throw error; }
    },
  };
}

export function document(overrides = {}) {
  return {
    document_id: "doc-one", source_name: "2026년 기초연금 안내.md", source_path: "source-md/2026년 기초연금 안내.md",
    sha256: sha256("fixture document"), byte_size: 16, document_year: "2026", category: "manual", document_type: "manual",
    publisher: "미표기", edition: "", effective_from: "", effective_to: "", topic: "기초연금", authority: "primary",
    source_role: "operational_manual", jurisdiction: "national", section_count: 1, ...overrides,
  };
}

export function section(overrides = {}) {
  const content = overrides.content ?? "기초연금 소득인정액 산정 기준을 확인합니다.\r\n";
  return {
    section_id: "section-one", document_id: "doc-one", ordinal: 0, node_id: "node-one", title: "소득인정액 산정 기준",
    heading_path: "기초연금 > 소득인정액", service_names: "기초연금", original_name: "2026년 기초연금 사업안내.pdf",
    upstream_original_name: "2026년 기초연금 안내.md", original_name_basis: "explicit_original_file_marker", original_name_line: 1,
    start_line: 20, end_line: 30, ...overrides, content, content_hash: overrides.content_hash ?? sha256(content),
  };
}

export function pack({ revision = "fixture-v1", createdAt = "2026-10-10T04:00:00Z", documents = [document()], sections = [section()], batchSize = 180 } = {}) {
  const assets = new Map();
  const batches = [];
  const input = [{ documents, sections: [] }];
  for (let offset = 0; offset < sections.length; offset += batchSize) input.push({ documents: [], sections: sections.slice(offset, offset + batchSize) });
  for (let index = 0; index < input.length; index++) {
    const path = `/__manual_corpus/${revision}/batch-${index}.json`;
    const bytes = new TextEncoder().encode(JSON.stringify({ schema_version: "manual-corpus-1", revision, batch_index: index, ...input[index] }));
    assets.set(path, bytes);
    batches.push({ path, sha256: sha256(bytes), bytes: bytes.byteLength, documents: input[index].documents.length, sections: input[index].sections.length });
  }
  const manifest = { schema_version: "manual-corpus-1", revision, source_repository: "https://gitlab.example.test/public/manuals", source_commit: "a".repeat(40), created_at: createdAt, document_count: documents.length, section_count: sections.length, batches };
  const load = async (path) => { assert.ok(assets.has(path)); return assets.get(path); };
  return { manifest, assets, load };
}

export async function activate(db, fixture, now = () => NOW) {
  for (let index = 0; index <= fixture.manifest.batches.length; index++) {
    const result = await advanceManualCorpus(db, fixture.load, fixture.manifest, { now });
    if (result.status === "ACTIVE") return result;
    assert.equal(result.status, "ADVANCED", JSON.stringify(result));
  }
  throw new Error("Corpus activation did not finish");
}
