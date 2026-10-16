// 보건복지상담센터(129) 자주하는 질문 수집본을 D1 마이그레이션으로 만든다.
// 입력: data/faq129/faq129.json (공식 FAQ 목록·상세를 그대로 저장한 원본). 출력: drizzle/0112_faq_129.sql
// 답변 문장·작성일은 원문 그대로 보존하고, 별칭(alias)은 질문 앞 괄호 표기·분야명·제도명 탐지 결과만 쓴다.
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { detectPrograms } from "../../lib/mcp/query-refiner.ts";

const root = new URL("../../", import.meta.url);
const raw = JSON.parse(readFileSync(new URL("data/faq129/faq129.json", root), "utf8"));
const items = raw.items;
if (!Array.isArray(items) || items.length < 700) throw new Error("FAQ 원본 항목 수가 예상보다 적습니다: " + items?.length);
const sha = (text) => createHash("sha256").update(text).digest("hex");
const q = (value) => value === null || value === undefined ? "NULL" : "'" + String(value).replaceAll("'", "''") + "'";
const revision = "faq129-" + String(raw.collected_at).slice(0, 10).replaceAll("-", "");
const seen = new Set();
const rows = [];
const aliases = [];
for (const item of items) {
  const id = String(item.faq_id).trim();
  if (!/^\d{1,10}$/.test(id) || seen.has(id)) throw new Error("FAQ ID가 비었거나 중복입니다: " + id);
  seen.add(id);
  if (!item.question?.trim() || !item.answer?.trim() || !/^\d{4}-\d{2}-\d{2}$/.test(item.written_date ?? "")) throw new Error("필수 항목 누락: " + id);
  rows.push({ id, group: item.group ?? null, category: item.category ?? null, question: item.question.trim(), answer: item.answer, written: item.written_date, views: Number(item.views) || 0, url: item.url, hash: sha(item.question.trim() + "\n" + item.answer) });
  const tags = new Set();
  const lead = /^\s*[(\[]([^)\]]{2,30})[)\]]/.exec(item.question);
  if (lead) tags.add("tag|" + lead[1].trim());
  if (item.category) tags.add("category|" + item.category.trim());
  for (const program of detectPrograms(item.question + " " + (lead?.[1] ?? ""))) tags.add("program|" + program);
  for (const tag of tags) { const [kind, value] = tag.split("|"); aliases.push([id, value, kind]); }
}
const lines = [
  "-- 보건복지상담센터(129) 자주하는 질문 " + items.length + "건(" + revision + "). 공식 Q&A 원문과 작성일을 보존한다.",
  "-- 생성: node scripts/faq129/build-migration.mjs. 답변은 작성일 기준 안내이며 현재 기준과 다를 수 있다.",
  "CREATE TABLE faq_129 (\n  faq_id TEXT PRIMARY KEY NOT NULL,\n  revision TEXT NOT NULL,\n  group_name TEXT,\n  category TEXT,\n  question TEXT NOT NULL,\n  answer TEXT NOT NULL,\n  written_date TEXT NOT NULL,\n  views INTEGER NOT NULL DEFAULT 0,\n  source_url TEXT NOT NULL,\n  content_sha256 TEXT NOT NULL\n);",
  "--> statement-breakpoint",
  "CREATE TABLE faq_129_alias (\n  faq_id TEXT NOT NULL REFERENCES faq_129(faq_id),\n  alias TEXT NOT NULL,\n  alias_kind TEXT NOT NULL CHECK (alias_kind IN ('tag','category','program')),\n  PRIMARY KEY (faq_id, alias, alias_kind)\n);",
  "--> statement-breakpoint",
  "CREATE INDEX faq_129_alias_alias ON faq_129_alias(alias);",
];
for (let index = 0; index < rows.length; index += 20) {
  const chunk = rows.slice(index, index + 20);
  lines.push("--> statement-breakpoint");
  lines.push("INSERT INTO faq_129 (faq_id, revision, group_name, category, question, answer, written_date, views, source_url, content_sha256) VALUES\n"
    + chunk.map((row) => "(" + [q(row.id), q(revision), q(row.group), q(row.category), q(row.question), q(row.answer), q(row.written), String(row.views), q(row.url), q(row.hash)].join(", ") + ")").join(",\n") + ";");
}
for (let index = 0; index < aliases.length; index += 200) {
  lines.push("--> statement-breakpoint");
  lines.push("INSERT INTO faq_129_alias (faq_id, alias, alias_kind) VALUES\n" + aliases.slice(index, index + 200).map((row) => "(" + row.map(q).join(", ") + ")").join(",\n") + ";");
}
writeFileSync(new URL("drizzle/0112_faq_129.sql", root), lines.join("\n") + "\n", "utf8");
console.log(JSON.stringify({ revision, faqs: rows.length, aliases: aliases.length }));

