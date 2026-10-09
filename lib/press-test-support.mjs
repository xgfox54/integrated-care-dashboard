// 보도자료 아카이브 시험 공용 도구: 실제 마이그레이션을 적용한 SQLite와 가짜 RSS 응답.
import { readdirSync, readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { setPressApproval } from "./press/admin.ts";
import { collectPressSource } from "./press/collect.ts";

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

export function database() {
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

export const SOURCE_ID = "src:mohw:press-rss";
export const BODY_MARKER = "SECRET-BODY-TEXT-DO-NOT-STORE";
export const NOW = 1_791_000_000;

export function itemXml({ title, link, pubDate = "Fri, 02 Oct 2026 07:50:00 GMT", guid = "" }) {
  return `<item><title><![CDATA[${title}]]></title><link>${link}</link>${guid ? `<guid>${guid}</guid>` : ""}<description><![CDATA[${BODY_MARKER} <link>https://evil.example/x</link>]]></description><pubDate>${pubDate}</pubDate><author>담당자이름</author></item>`;
}

export function feedXml(items) {
  return `<?xml version="1.0" encoding="UTF-8"?><rss version="2.0"><channel><title>t</title>${items.map(itemXml).join("")}</channel></rss>`;
}

export const url = (listNo) => `https://www.mohw.go.kr/board.es?mid=a10503000000&amp;bid=0027&amp;list_no=${listNo}&amp;act=view`;

export function response(status, body = "", headers = {}) {
  const lower = Object.fromEntries(Object.entries(headers).map(([key, value]) => [key.toLowerCase(), value]));
  return { status, headers: { get: (name) => lower[name.toLowerCase()] ?? null }, text: async () => body };
}

export function collectDeps(fetcher, extra = {}) {
  let counter = 0;
  const clock = { now: NOW };
  return {
    clock,
    deps: { fetcher, now: () => clock.now, sleep: async () => {}, newId: () => `id-${++counter}`, ...extra },
  };
}

export async function sourceOf(db) {
  const { readSource } = await import("./press/store.ts");
  return readSource(db, SOURCE_ID);
}

/** 실제 스키마와 승인 상태를 쓰는 수집 회귀 테스트 공용 fixture. */
export async function collectionFixture(feed) {
  const db = database();
  if (!(await setPressApproval(db, SOURCE_ID, "approve", NOW))) throw new Error("Test source approval failed");
  const source = await sourceOf(db);
  const calls = [];
  const ctx = collectDeps(async (address, headers) => {
    if (address.endsWith("/robots.txt")) return ctx.robots ? ctx.robots() : response(404);
    calls.push({ address, headers });
    return ctx.next ? ctx.next(address, headers) : response(200, feedXml(feed));
  });
  return { db, source, calls, ctx, run: () => collectPressSource(db, { source, trigger: "manual" }, ctx.deps) };
}
