import assert from "node:assert/strict";
import test from "node:test";
import { memoizeForTtl } from "./memo.ts";

test("진행 중 요청이 실패해도 다른 요청은 독립적으로 완료하며 완료 값만 재사용한다", async () => {
  let rejectFirst;
  let count = 0;
  const load = memoizeForTtl(() => {
    count += 1;
    return count === 1 ? new Promise((_, reject) => { rejectFirst = reject; }) : Promise.resolve("second");
  }, 60_000);
  const first = load();
  const firstFailed = assert.rejects(first, /canceled/);
  assert.equal(await load(), "second");
  rejectFirst(new Error("canceled"));
  await firstFailed;
  assert.equal(await load(), "second");
  assert.equal(count, 2);
});

test("만료된 값과 실패는 저장하지 않고 다음 요청에서 다시 읽는다", async () => {
  let count = 0;
  const load = memoizeForTtl(async () => {
    count += 1;
    if (count === 1) throw new Error("unavailable");
    return count;
  }, 0);
  await assert.rejects(load(), /unavailable/);
  assert.equal(await load(), 2);
  assert.equal(await load(), 3);
});

test("먼저 시작한 이전 조회가 늦게 끝나도 새 조회의 저장 값을 덮어쓰지 않는다", async () => {
  const finish = [];
  const load = memoizeForTtl(() => new Promise((resolve) => finish.push(resolve)), 60_000);
  const oldRequest = load();
  const newRequest = load();
  finish[1]("new");
  assert.equal(await newRequest, "new");
  finish[0]("old");
  assert.equal(await oldRequest, "old");
  assert.equal(await load(), "new");
  assert.equal(finish.length, 2);
});
