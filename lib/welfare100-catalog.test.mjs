import assert from "node:assert/strict";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import test from "node:test";

const base = new URL("../public/data/welfare100/", import.meta.url);
const readJson = (relative) => JSON.parse(readFileSync(new URL(relative, base), "utf8"));
const TOPICS = ["생활지원", "신체건강", "정신건강", "주거", "일자리", "문화·여가", "안전·위기", "임신·출산", "보육", "교육", "입양·위탁", "보호·돌봄", "서민금융", "법률", "에너지"];

test("복지제도 대장 색인은 중앙부처·지자체 서비스 전체와 주요 제도 100개를 담는다", () => {
  const index = readJson("index.json");
  assert.equal(index.total, index.items.length);
  const slugs = new Set(index.items.map((row) => row.s));
  assert.equal(slugs.size, index.items.length, "제도 번호가 겹치면 안 된다");
  assert.equal(index.items.filter((row) => row.a === 1).length, 100);
  assert.ok(index.items.filter((row) => row.g === 1).length > 4000, "지자체 서비스가 빠지면 안 된다");
  assert.ok(index.items.filter((row) => row.g === 0).length > 400, "중앙부처 서비스가 빠지면 안 된다");
  for (const row of index.items) {
    assert.ok(row.n.trim().length > 0, row.s + " 이름 없음");
    assert.ok(row.t.length > 0 && row.t.every((topic) => TOPICS.includes(topic)), row.s + " 분야가 복지로 관심주제가 아님: " + row.t);
    assert.equal(row.c, row.t[0]);
    assert.ok(row.p >= 2, row.s + " 업무구조도 노드 부족");
    if (row.g === 1 && row.a === 0) assert.ok(row.sd, row.s + " 지자체 서비스의 시도 누락");
  }
});

test("색인의 모든 제도는 상세 파일이 있고, 합쳐진 복지로 번호는 대표 제도로 이어진다", () => {
  const index = readJson("index.json");
  const slugs = new Set(index.items.map((row) => row.s));
  for (const slug of slugs) {
    assert.ok(existsSync(new URL("items/" + slug + ".json", base)), slug + " 상세 파일 없음");
  }
  let aliases = 0;
  for (const file of readdirSync(new URL("items/", base))) {
    const payload = readJson("items/" + file);
    if (payload.kind === "alias") {
      aliases++;
      assert.ok(slugs.has(payload.slug), file + " → " + payload.slug + " 대표 제도 없음");
      assert.equal(readJson("items/" + payload.slug + ".json").kind, "curated");
    } else {
      assert.ok(slugs.has(file.replace(/\.json$/, "")), file + " 색인에 없는 상세 파일");
    }
  }
  assert.ok(aliases > 50, "주요 제도와 합친 복지로 번호가 있어야 한다");
});

test("가벼운 색인과 추가 색인을 합치면 전체 색인과 같다", () => {
  const index = readJson("index.json");
  const lite = readJson("index-lite.json");
  const extra = readJson("index-extra.json");
  assert.equal(lite.total, index.total);
  assert.equal(extra.total, index.total);
  assert.equal(lite.asOf, index.asOf);
  assert.equal(extra.asOf, index.asOf);
  const unpack = (packed) => packed.items.map((values) => Object.fromEntries(packed.fields.map((field, position) => [field, values[position]])));
  const extras = new Map(unpack(extra).map((row) => [row.s, row]));
  const merged = unpack(lite).map((row) => ({ ...row, ...extras.get(row.s) }));
  assert.deepEqual(merged, index.items);
  assert.ok(!lite.fields.includes("laws") && !lite.fields.includes("d"), "법령·담당은 추가 색인에만 둔다");
});
