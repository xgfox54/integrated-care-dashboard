import assert from "node:assert/strict";
import test from "node:test";
import { rememberedFor } from "./fiscal/response-cache.ts";
import { database } from "./press-test-support.mjs";

test("simultaneous budget metadata requests share one pending database computation", async (t) => {
  // Given: separate consumers need the same metadata before its first read completes.
  const db = database();
  t.after(() => db.sqlite.close());
  const gate = Promise.withResolvers();
  let computations = 0;
  const compute = () => { computations++; return gate.promise; };
  // When: both preloaded budget responses request it concurrently.
  const pending = Array.from({ length: 12 }, () => rememberedFor(db, "published", 60_000, compute));
  const started = computations;
  gate.resolve({ snapshot: "approved-a" });
  const values = await Promise.all(pending);
  // Then: one computation supplies the same metadata to every consumer.
  assert.equal(started, 1);
  assert.deepEqual(values, Array.from({ length: 12 }, () => ({ snapshot: "approved-a" })));
});

test("a failed budget metadata computation can be retried", async (t) => {
  // Given: the first database read fails.
  const db = database();
  t.after(() => db.sqlite.close());
  const failure = new Error("database unavailable");
  await assert.rejects(rememberedFor(db, "units", 60_000, () => Promise.reject(failure)), failure);
  // When: the database recovers.
  const value = await rememberedFor(db, "units", 60_000, async () => ["verified-unit"]);
  // Then: the rejected read does not poison the metadata cache.
  assert.deepEqual(value, ["verified-unit"]);
});

test("budget metadata remains isolated by database and validation key", async (t) => {
  // Given: different databases and publication revisions.
  const first = database(), second = database();
  t.after(() => { first.sqlite.close(); second.sqlite.close(); });
  // When: their metadata is read under independent keys.
  const values = await Promise.all([
    rememberedFor(first, "published:a", 60_000, async () => "first-a"),
    rememberedFor(first, "published:b", 60_000, async () => "first-b"),
    rememberedFor(second, "published:a", 60_000, async () => "second-a"),
  ]);
  // Then: values cannot cross a database or revision boundary.
  assert.deepEqual(values, ["first-a", "first-b", "second-a"]);
});
