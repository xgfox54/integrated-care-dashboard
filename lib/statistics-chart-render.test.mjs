import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import ts from "typescript";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

const source = await readFile(new URL("../components/statistics/statistics-charts.tsx", import.meta.url), "utf8");
const compiled = ts.transpileModule(source, { compilerOptions: { jsx: ts.JsxEmit.ReactJSX, module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } }).outputText
  .replaceAll('"@/lib/statistics/presentation"', JSON.stringify(new URL("./statistics/presentation.ts", import.meta.url).href))
  .replaceAll('"react/jsx-runtime"', JSON.stringify(import.meta.resolve("react/jsx-runtime")));
const { StatisticsSeriesChart } = await import(`data:text/javascript;base64,${Buffer.from(compiled).toString("base64")}`);
const points = [2022, 2023, 2024].map((year, index) => ({ period: String(year), value: index + 1, raw: String(index + 1), status: index === 2 ? "ESTIMATE" : "VALUE" }));

test("추이 점의 도움말이 서버에서도 같은 완성 문자열로 렌더링된다", () => {
  const html = renderToStaticMarkup(createElement(StatisticsSeriesChart, { points, label: "예시 인원", unit: "명" }));
  assert.ok(html.includes("<title>2022년: 1 명 · 수록값</title>"));
  assert.ok(html.includes("<title>2024년: 3 명 · 추정치</title>"));
});

test("한 시점은 SVG 추이선을 만들지 않고 두 시점은 막대로 표시한다", () => {
  const one = renderToStaticMarkup(createElement(StatisticsSeriesChart, { points: points.slice(0, 1), label: "예시", unit: "명" }));
  const two = renderToStaticMarkup(createElement(StatisticsSeriesChart, { points: points.slice(0, 2), label: "예시", unit: "명" }));
  assert.ok(!one.includes("<svg"));
  assert.equal((two.match(/<rect /g) ?? []).length, 2);
  assert.ok(!two.includes("<polyline"));
});
