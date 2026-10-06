import { readFileSync, readdirSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";

export const restorationFixture = JSON.parse(readFileSync(new URL("./fixtures/mohw/source-restoration.json", import.meta.url), "utf8"));
export function businessDatabase(path = ":memory:") {
  const sqlite = new DatabaseSync(path);
  const dir = new URL("../drizzle/", import.meta.url);
  for (const file of readdirSync(dir).filter((name) => name.endsWith(".sql")).sort()) {
    sqlite.exec(readFileSync(new URL(file, dir), "utf8"));
  }
  function prepare(sql, values = []) {
    return {
      bind: (...bound) => prepare(sql, bound),
      first: async () => sqlite.prepare(sql).get(...values) ?? null,
      all: async () => ({ results: sqlite.prepare(sql).all(...values) }),
      run: async () => sqlite.prepare(sql).run(...values),
    };
  }
  sqlite.prepare("INSERT INTO official_sync_run (id, trigger, status, started_at, completed_at) VALUES ('fixture', 'manual', 'succeeded', 1791182652, 1791182652)").run();
  return { sqlite, prepare };
}
