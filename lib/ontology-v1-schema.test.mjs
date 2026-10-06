// ontology/v1 스키마가 실제 반입 검사기·Factory 묶음과 같은 규칙인지 확인한다(T34 산출물).
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { Validator } from "@cfworker/json-schema";

import { buildDocumentPack } from "../factory/release/pack-builder.mjs";
import { readZip } from "./imports/zip.ts";

const schema = (name) => new Validator(JSON.parse(readFileSync(new URL("../ontology/v1/" + name, import.meta.url), "utf8")), "2020-12", false);
const lines = (path) => readFileSync(new URL("../factory/tests/fixtures/roundtrip/two-sources/data/knowledge/" + path, import.meta.url), "utf8").split("\n").filter(Boolean).map((line) => JSON.parse(line));

test("왕복 fixture의 사실·근거 행이 ontology/v1 스키마를 통과하고, 바꾼 행은 거절된다", () => {
  const statement = schema("statement.schema.json");
  const evidence = schema("evidence.schema.json");
  for (const row of lines("statements.jsonl")) assert.ok(statement.validate(row).valid, JSON.stringify(row));
  for (const row of lines("evidence.jsonl")) assert.ok(evidence.validate(row).valid, JSON.stringify(row));
  assert.equal(statement.validate({ ...lines("statements.jsonl")[0], review_status: "candidate" }).valid, false);
  assert.equal(evidence.validate({ ...lines("evidence.jsonl")[0], physical_page_verified: true }).valid, false);
  assert.equal(statement.validate({ ...lines("statements.jsonl")[0], summary: "x" }).valid, false);
});

test("Factory가 만든 묶음의 manifest가 release-manifest 스키마를 통과한다", async () => {
  const sources = JSON.parse("[" + readFileSync(new URL("../factory/tests/fixtures/roundtrip/two-sources/data/knowledge/sources.jsonl", import.meta.url), "utf8").trim().split("\n").join(",") + "]");
  const facts = lines("statements.jsonl").map((row) => ({ ...row, evidence: lines("evidence.jsonl").filter((proof) => proof.statement_id === row.statement_id) }));
  const pack = await buildDocumentPack({ artifactId: "schema-check-0001", createdAt: "2026-10-04T00:00:00Z", producerRunId: "t", mappingVersion: "m1", baseSourceRunId: null, sources, facts });
  const manifest = JSON.parse(new TextDecoder().decode((await readZip(pack.zip)).find((entry) => entry.path === "manifest.json").bytes));
  const validator = schema("release-manifest.schema.json");
  assert.ok(validator.validate(manifest).valid, JSON.stringify(validator.validate(manifest).errors.slice(0, 3)));
  assert.equal(validator.validate({ ...manifest, format: "opencrab-pack-v1" }).valid, false);
  assert.equal(validator.validate({ ...manifest, modules_present: ["knowledge", "news"] }).valid, false);
});
