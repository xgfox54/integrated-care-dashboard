import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const filterSource = await readFile(
  new URL("../components/dashboard/filter-panel.tsx", import.meta.url),
  "utf8",
);

test("dashboard search warns users not to enter personal information", () => {
  assert.match(filterSource, /대상자 이름, 주민등록번호, 전화번호 등 개인정보는 입력하지 마세요/);
});
